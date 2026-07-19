// ── LineEditor — raw-mode input line with a live region below it ──────────────
// Replaces readline for the REPL prompt. Owns exactly one input row plus an
// optional repaintable region below (command palette, status line, hints).
// Every keystroke triggers a full repaint of row + region with relative cursor
// moves only, so it stays aligned even when the terminal scrolls.
//
// Falls back to plain readline when stdin is not a TTY (pipes, CI).

import * as readline from 'node:readline';
import { vLen } from './ui.js';

export interface EditorKey {
  sequence?: string;
  name?:     string;
  ctrl?:     boolean;
  meta?:     boolean;
  shift?:    boolean;
}

export interface LineEditorOpts {
  /** Prompt string (may contain ANSI colors). Must be a single line. */
  prompt: () => string;
  /** Called with the submitted line. Editor suspends itself until resume(). */
  onSubmit: (line: string) => void;
  /** Lines painted below the input row. Re-queried on every repaint. */
  below?: () => string[];
  /**
   * Key interceptor — runs before default handling (palette navigation).
   * Return true to consume the key (editor only repaints).
   */
  intercept?: (str: string | undefined, key: EditorKey) => boolean;
  /** Buffer changed (insert/delete/history recall). */
  onChange?: (line: string) => void;
  /** Ctrl+C pressed. Editor clears a non-empty line itself before calling. */
  onCtrlC?: () => void;
  /** Ctrl+D / Ctrl+N style extra bindings the host wants. Return true if handled. */
  onCtrlKey?: (name: string) => boolean;
  /** Esc pressed with the interceptor not consuming it. Return true if handled. */
  onEscape?: () => boolean;
  /** Tab pressed and not intercepted. */
  onTab?: () => void;
  /** Input stream ended (non-TTY fallback only). */
  onEof?: () => void;
  history?: string[];
  historySize?: number;
  /**
   * Managed mode: the editor never writes to stdout. The host (full-screen TUI)
   * queries getLine()/visibleSlice() and repaints when onDirty fires.
   */
  managed?: boolean;
  /** Managed mode only: state changed, host should repaint. */
  onDirty?: () => void;
}

export class LineEditor {
  private line      = '';
  private cursor    = 0;
  private viewStart = 0;

  private history:  string[];
  private histIdx   = -1;     // -1 → editing the draft
  private draft     = '';
  private histSize: number;

  private belowCount = 0;      // rows currently painted below the input row
  private started    = false;
  private suspended  = true;   // no painting / no input until resume()
  private listener:  ((str: string | undefined, key: EditorKey) => void) | null = null;
  private resizeFn:  (() => void) | null = null;

  // Non-TTY fallback
  private fallbackRl: readline.Interface | null = null;
  private pendingLines: string[] = [];

  constructor(private opts: LineEditorOpts) {
    this.history  = opts.history ?? [];
    this.histSize = opts.historySize ?? 200;
  }

  static supported(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;

    if (!LineEditor.supported()) {
      this.fallbackRl = readline.createInterface({ input: process.stdin, output: process.stdout });
      this.fallbackRl.on('line', l => {
        if (this.suspended) { this.pendingLines.push(l); return; }
        this.suspended = true;
        this.opts.onSubmit(l);
      });
      this.fallbackRl.on('close', () => { this.opts.onEof?.(); });
      this.suspended = false;
      return;
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    this.listener = (str, key) => this.handleKey(str, key ?? {});
    process.stdin.on('keypress', this.listener);

    this.resizeFn = () => { if (!this.suspended) this.render(); };
    process.stdout.on('resize', this.resizeFn);

    this.resume();
  }

  /** Stop reacting to keys and clear the painted region (output may follow). */
  pause(): void {
    if (this.suspended) return;
    this.suspended = true;
    if (this.opts.managed) { this.opts.onDirty?.(); return; }
    this.clearBelow();
  }

  /** Paint a fresh prompt row at the current cursor position and accept input. */
  resume(): void {
    if (this.fallbackRl) {
      this.suspended = false;
      const queued = this.pendingLines.shift();
      if (queued !== undefined) { this.suspended = true; this.opts.onSubmit(queued); return; }
      process.stdout.write(this.opts.prompt());
      return;
    }
    this.suspended = false;
    if (this.opts.managed) { this.opts.onDirty?.(); return; }
    this.belowCount = 0;
    this.render();
  }

  destroy(): void {
    this.pause();
    if (this.listener) { process.stdin.removeListener('keypress', this.listener); this.listener = null; }
    if (this.resizeFn) { process.stdout.removeListener('resize', this.resizeFn); this.resizeFn = null; }
    if (this.fallbackRl) { this.fallbackRl.close(); this.fallbackRl = null; }
    if (!this.opts.managed) process.stdout.write('\x1B[?25h');
    this.started = false;
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  getLine(): string  { return this.line; }
  isActive(): boolean { return this.started && !this.suspended; }

  setLine(text: string, cursor?: number): void {
    this.line   = text;
    this.cursor = cursor ?? text.length;
    this.opts.onChange?.(this.line);
    if (!this.suspended) this.render();
  }

  /** Repaint (prompt/status/palette content changed externally). */
  refresh(): void {
    if (!this.suspended && !this.fallbackRl) this.render();
  }

  /** Programmatic submit (palette Enter). */
  submit(text?: string): void {
    if (text !== undefined) { this.line = text; this.cursor = text.length; }
    this.finishLine();
  }

  // ── Key handling ────────────────────────────────────────────────────────────

  private handleKey(str: string | undefined, key: EditorKey): void {
    if (this.suspended) return;

    if (this.opts.intercept?.(str, key)) { this.render(); return; }

    // Ctrl combos
    if (key.ctrl && !key.meta) {
      switch (key.name) {
        case 'c':
          if (this.line.length > 0) { this.setLine(''); }
          this.opts.onCtrlC?.();
          this.render();
          return;
        case 'a': this.cursor = 0;                this.render(); return;
        case 'e': this.cursor = this.line.length; this.render(); return;
        case 'b': this.moveCursor(-1);            this.render(); return;
        case 'f': this.moveCursor(1);             this.render(); return;
        case 'u':
          this.line = this.line.slice(this.cursor); this.cursor = 0;
          this.changed(); return;
        case 'k':
          this.line = this.line.slice(0, this.cursor);
          this.changed(); return;
        case 'w': this.deleteWordBack(); return;
        case 'l':
          if (this.opts.managed) { this.opts.onCtrlKey?.('l'); this.render(); return; }
          process.stdout.write('\x1Bc');
          this.belowCount = 0;
          this.render();
          return;
        case 'z': return; // ignore suspend (SIGTSTP) — keep TUI alive
        case 'left':  this.wordLeft();  this.render(); return;
        case 'right': this.wordRight(); this.render(); return;
        default:
          if (key.name && this.opts.onCtrlKey?.(key.name)) return;
          return;
      }
    }

    switch (key.name) {
      case 'return':
      case 'enter':
        this.finishLine();
        return;
      case 'backspace':
        if (key.meta) { this.deleteWordBack(); return; }
        if (this.cursor > 0) {
          this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor);
          this.cursor--;
          this.changed();
        }
        return;
      case 'delete':
        if (this.cursor < this.line.length) {
          this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + 1);
          this.changed();
        }
        return;
      case 'left':  this.moveCursor(-1); this.render(); return;
      case 'right': this.moveCursor(1);  this.render(); return;
      case 'home':  this.cursor = 0;                this.render(); return;
      case 'end':   this.cursor = this.line.length; this.render(); return;
      case 'up':    this.historyMove(-1); return;
      case 'down':  this.historyMove(1);  return;
      case 'tab':
        this.opts.onTab?.();
        this.render();
        return;
      case 'escape':
        if (this.opts.onEscape?.()) { this.render(); return; }
        if (this.line) this.setLine('');
        return;
    }

    // Word-jump via Alt+b / Alt+f
    if (key.meta && key.name === 'b') { this.wordLeft();  this.render(); return; }
    if (key.meta && key.name === 'f') { this.wordRight(); this.render(); return; }

    // Printable input (including multi-char paste chunks)
    if (str && !key.ctrl && !key.meta) {
      const clean = str.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1F\x7F]/g, '');
      if (!clean) return;
      this.line   = this.line.slice(0, this.cursor) + clean + this.line.slice(this.cursor);
      this.cursor += clean.length;
      this.changed();
    }
  }

  private changed(): void {
    this.histIdx = -1;
    this.opts.onChange?.(this.line);
    this.render();
  }

  private moveCursor(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.line.length, this.cursor + delta));
  }

  private wordLeft(): void {
    let i = this.cursor;
    while (i > 0 && /\s/.test(this.line[i - 1])) i--;
    while (i > 0 && /\S/.test(this.line[i - 1])) i--;
    this.cursor = i;
  }

  private wordRight(): void {
    let i = this.cursor;
    while (i < this.line.length && /\s/.test(this.line[i])) i++;
    while (i < this.line.length && /\S/.test(this.line[i])) i++;
    this.cursor = i;
  }

  private deleteWordBack(): void {
    const end = this.cursor;
    this.wordLeft();
    this.line = this.line.slice(0, this.cursor) + this.line.slice(end);
    this.changed();
  }

  private historyMove(delta: number): void {
    if (!this.history.length) return;
    if (this.histIdx === -1 && delta < 0) {
      this.draft   = this.line;
      this.histIdx = this.history.length - 1;
    } else if (this.histIdx !== -1) {
      this.histIdx += delta > 0 ? 1 : -1;
      if (this.histIdx >= this.history.length) {
        this.histIdx = -1;
      } else if (this.histIdx < 0) {
        this.histIdx = 0;
      }
    } else {
      return; // down on draft — nothing to do
    }
    this.line   = this.histIdx === -1 ? this.draft : this.history[this.histIdx];
    this.cursor = this.line.length;
    this.opts.onChange?.(this.line);
    this.render();
  }

  private finishLine(): void {
    const text = this.line;
    if (text.trim()) {
      if (this.history[this.history.length - 1] !== text) {
        this.history.push(text);
        if (this.history.length > this.histSize) this.history.shift();
      }
    }
    this.histIdx = -1;
    this.draft   = '';

    // Final paint: prompt + full line, region cleared, then move past it.
    // (Managed mode: the host repaints; nothing to write here.)
    if (!this.opts.managed) {
      this.paint(true);
      process.stdout.write('\n');
    }

    this.line      = '';
    this.cursor    = 0;
    this.viewStart = 0;
    this.suspended = true;
    this.belowCount = 0;
    this.opts.onSubmit(text);
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private clearBelow(): void {
    if (this.fallbackRl) return;
    // Cursor sits on the input row: wipe everything beneath it, stay in place.
    if (this.belowCount > 0) {
      process.stdout.write('\x1B[?25l\x1B[s');
      process.stdout.write('\n\x1B[0J');
      process.stdout.write('\x1B[u\x1B[?25h');
      // \x1B[s/u are absolute; if painting scrolled the screen they can be off,
      // but clearBelow is only called from a settled prompt row.
      this.belowCount = 0;
    }
  }

  /**
   * Horizontal viewport for a given available width. Public so a managed host
   * can render the input row itself and place the hardware cursor.
   */
  visibleSlice(avail: number): { text: string; col: number; leftMore: boolean; rightMore: boolean } {
    if (this.cursor < this.viewStart)         this.viewStart = this.cursor;
    if (this.cursor > this.viewStart + avail) this.viewStart = this.cursor - avail;
    if (this.viewStart > 0 && this.line.length - this.viewStart < avail) {
      this.viewStart = Math.max(0, this.line.length - avail);
    }
    return {
      text:      this.line.slice(this.viewStart, this.viewStart + avail),
      col:       this.cursor - this.viewStart,
      leftMore:  this.viewStart > 0,
      rightMore: this.viewStart + avail < this.line.length,
    };
  }

  private render(): void {
    if (this.suspended || this.fallbackRl) return;
    if (this.opts.managed) { this.opts.onDirty?.(); return; }
    this.paint(false);
  }

  /** Repaint input row + below region. Assumes cursor is on the input row. */
  private paint(final: boolean): void {
    const cols    = process.stdout.columns || 80;
    const prompt  = this.opts.prompt();
    const promptW = vLen(prompt);
    const avail   = Math.max(8, cols - promptW - 2);

    const { text: visible, col: cursorCol, leftMore, rightMore } = this.visibleSlice(avail);

    let buf = '\x1B[?25l\r\x1B[0J';
    buf += prompt;
    if (leftMore)  buf += '\x1B[2m…\x1B[22m';
    buf += visible;
    if (rightMore) buf += '\x1B[2m…\x1B[22m';

    let rows = 0;
    if (!final && this.opts.below) {
      const below = this.opts.below();
      for (const raw of below) {
        buf += '\n\x1B[2K' + truncateAnsi(raw, cols - 1);
        rows++;
      }
    }

    // Return to the input row, restore column
    if (rows > 0) buf += `\x1B[${rows}A`;
    const col = promptW + (leftMore ? 1 : 0) + cursorCol;
    buf += '\r';
    if (col > 0) buf += `\x1B[${col}C`;
    buf += '\x1B[?25h';

    process.stdout.write(buf);
    this.belowCount = rows;
  }
}

// ── ANSI-aware truncation ─────────────────────────────────────────────────────
// Cuts a colored string to `width` visible chars, preserving escape sequences
// and appending a reset so colors never bleed into the next row.
export function truncateAnsi(s: string, width: number): string {
  let visible = 0;
  let out     = '';
  let i       = 0;
  while (i < s.length) {
    if (s[i] === '\x1B') {
      // CSI: ESC [ ... letter
      const csi = /^\x1B\[[0-9;]*[A-Za-z]/.exec(s.slice(i));
      if (csi) { out += csi[0]; i += csi[0].length; continue; }
      // DEC private: ESC [ ? ... letter
      const dec = /^\x1B\[\?[0-9;]*[A-Za-z]/.exec(s.slice(i));
      if (dec) { out += dec[0]; i += dec[0].length; continue; }
      // OSC: ESC ] ... (BEL or ST)
      const osc = /^\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/.exec(s.slice(i));
      if (osc) { out += osc[0]; i += osc[0].length; continue; }
    }
    if (visible >= width) break;
    out += s[i];
    visible++;
    i++;
  }
  return out + '\x1B[0m';
}
