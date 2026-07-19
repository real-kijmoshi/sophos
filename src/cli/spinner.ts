// ── Spinner ───────────────────────────────────────────────────────────────────
// Braille-dot spinner with elapsed time and live token counter.
// Frame rate capped at 80ms to avoid excessive redraws.
// Writes directly to process.stdout so it works independently of readline.

import { c, formatDuration } from './ui.js';
import { FRAMES } from './spinner-frames.js';

const FRAME_MS = 80;

export interface SpinnerOpts {
  text?: string;
  /** Show a live token counter fed via .addTokens() */
  showTokens?: boolean;
}

export class Spinner {
  private frame        = 0;
  private timer:       ReturnType<typeof setInterval> | null = null;
  private startMs      = 0;
  private tokens       = 0;
  private lastText     = '';
  private text:        string;
  private showTokens:  boolean;
  private linesWritten = 0;

  constructor(opts: SpinnerOpts = {}) {
    this.text       = opts.text       ?? '';
    this.showTokens = opts.showTokens ?? false;
  }

  start(text?: string): this {
    if (text) this.text = text;
    this.startMs = Date.now();
    this.frame   = 0;
    this.tokens  = 0;
    this.linesWritten = 0;

    // Hide cursor
    process.stdout.write('\x1B[?25l');

    this.timer = setInterval(() => this.tick(), FRAME_MS);
    this.tick();
    return this;
  }

  stop(finalText?: string): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;

    // Erase spinner line
    this.erase();

    // Show cursor
    process.stdout.write('\x1B[?25h');

    if (finalText) {
      process.stdout.write(finalText + '\n');
    }
  }

  succeed(text?: string): void {
    this.stop(`  ${c.success('✓')} ${c.text(text ?? this.text)}  ${c.dim(formatDuration(Date.now() - this.startMs))}`);
  }

  fail(text?: string): void {
    this.stop(`  ${c.error('✗')} ${c.text(text ?? this.text)}`);
  }

  warn(text?: string): void {
    this.stop(`  ${c.warning('⚠')} ${c.text(text ?? this.text)}`);
  }

  setText(text: string): void {
    this.text = text;
  }

  addTokens(n: number): void {
    this.tokens += n;
  }

  elapsed(): number {
    return Date.now() - this.startMs;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private tick(): void {
    this.erase();
    const line = this.buildLine();
    process.stdout.write(line);
    this.lastText = line;
    this.frame = (this.frame + 1) % FRAMES.length;
  }

  private buildLine(): string {
    const spin    = c.primary(FRAMES[this.frame]);
    const elapsed = c.dim(formatDuration(Date.now() - this.startMs));
    const tokens  = this.showTokens && this.tokens > 0
      ? c.dim(` · ${fmtTokens(this.tokens)} tok`)
      : '';
    const text    = this.text ? c.muted(this.text) : '';
    return `  ${spin} ${text}  ${elapsed}${tokens}`;
  }

  private erase(): void {
    if (this.lastText) {
      // Move to start of line and erase it
      process.stdout.write('\r\x1B[2K');
      this.lastText = '';
    }
  }
}

// ── Streaming token display ───────────────────────────────────────────────────
// Renders a live token stream inline, like Claude Code's output.

export class TokenStreamer {
  private buffer   = '';
  private lineLen  = 0;
  private maxWidth = Math.min(process.stdout.columns || 80, 96) - 4;

  constructor(private indent = '  ') {}

  write(chunk: string): void {
    this.buffer += chunk;

    // Flush complete words to avoid partial-word rendering
    const lines = this.buffer.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      this.writeLine(lines[i]);
      process.stdout.write('\n');
      this.lineLen = 0;
    }
    this.buffer = lines[lines.length - 1];

    // If the buffered partial line is long enough, flush it too
    if (this.buffer.length > 60) {
      const lastSpace = this.buffer.lastIndexOf(' ', 60);
      if (lastSpace > 0) {
        this.writeLine(this.buffer.slice(0, lastSpace));
        this.buffer = this.buffer.slice(lastSpace + 1);
      }
    }
  }

  flush(): void {
    if (this.buffer) {
      this.writeLine(this.buffer);
      this.buffer = '';
    }
    if (this.lineLen > 0) {
      process.stdout.write('\n');
      this.lineLen = 0;
    }
  }

  private writeLine(text: string): void {
    if (this.lineLen === 0) {
      process.stdout.write(this.indent + c.text(text));
    } else {
      process.stdout.write(c.text(text));
    }
    this.lineLen += text.length;

    if (this.lineLen > this.maxWidth) {
      process.stdout.write('\n');
      this.lineLen = 0;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Global spinner singleton ──────────────────────────────────────────────────
export const spinner = new Spinner({ showTokens: true });
