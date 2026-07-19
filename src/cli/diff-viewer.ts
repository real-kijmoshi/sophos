// ── Interactive Diff Viewer ───────────────────────────────────────────────────
// Terminal-native scrollable diff viewer with file navigation.
// Supports: arrow keys to scroll, q to close, n/p for next/prev file.

import * as readline from 'node:readline';
import { c, W, ANSI, formatDuration, diffCard } from './ui.js';

export interface DiffFile {
  name:   string;
  addCount: number;
  delCount: number;
  lines:  string[];
}

export class InteractiveDiffViewer {
  private files: DiffFile[] = [];
  private currentFile = 0;
  private scrollOffset = 0;
  private linesRendered = 0;
  private rl: readline.Interface | null = null;

  /** Parse unified diff text into structured files */
  parse(diffText: string): void {
    this.files = [];
    const chunks = diffText.split(/^diff --git/m).filter(Boolean);

    for (const chunk of chunks) {
      const nameMatch = chunk.match(/a\/(.+?) b\//);
      const fileName  = nameMatch?.[1] ?? 'unknown';
      const addCount  = (chunk.match(/^\+(?!\+\+)/gm) ?? []).length;
      const delCount  = (chunk.match(/^-(?!--)/gm)    ?? []).length;
      const lines     = chunk.split('\n');
      this.files.push({ name: fileName, addCount, delCount, lines });
    }
  }

  /** Show interactive diff viewer — blocks until user presses q */
  async show(): Promise<void> {
    if (!this.files.length) {
      console.log(`\n  ${c.muted('No changes to display.\n')}`);
      return;
    }

    this.currentFile  = 0;
    this.scrollOffset = 0;
    this.linesRendered = 0;

    process.stdout.write(ANSI.hideCursor);
    this.render();

    return new Promise<void>(resolve => {
      this.rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
        terminal: true,
      });

      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('keypress', this.onKeypress = (_str, key) => {
        if (!key) return;
        switch (key.name) {
          case 'q': case 'escape':
            this.cleanup();
            resolve();
            break;
          case 'n': case 'right':
            this.nextFile();
            break;
          case 'p': case 'left':
            this.prevFile();
            break;
          case 'up':
            this.scrollUp();
            break;
          case 'down':
            this.scrollDown();
            break;
          case 'g':
            this.scrollOffset = 0;
            this.render();
            break;
          case 'G':
            this.scrollOffset = Math.max(0, this.files[this.currentFile].lines.length - this.visibleLines());
            this.render();
            break;
        }
      });
    });
  }

  private onKeypress?: (str: string, key: any) => void;

  private nextFile(): void {
    if (this.currentFile < this.files.length - 1) {
      this.currentFile++;
      this.scrollOffset = 0;
      this.render();
    }
  }

  private prevFile(): void {
    if (this.currentFile > 0) {
      this.currentFile--;
      this.scrollOffset = 0;
      this.render();
    }
  }

  private scrollUp(): void {
    if (this.scrollOffset > 0) {
      this.scrollOffset--;
      this.render();
    }
  }

  private scrollDown(): void {
    const file = this.files[this.currentFile];
    const maxOffset = Math.max(0, file.lines.length - this.visibleLines());
    if (this.scrollOffset < maxOffset) {
      this.scrollOffset++;
      this.render();
    }
  }

  private visibleLines(): number {
    return Math.max(10, (process.stdout.rows || 24) - 8);
  }

  private render(): void {
    const w = W();
    const file = this.files[this.currentFile];
    const visLines = this.visibleLines();
    const maxScroll = Math.max(0, file.lines.length - visLines);

    const lines: string[] = [];

    // Header bar
    const fileLabel = `${this.currentFile + 1}/${this.files.length}  ${file.name}`;
    const stats = `+${file.addCount} -${file.delCount}`;
    lines.push(`  ${c.accent.bold(fileLabel)}  ${c.success(`+${file.addCount}`)} ${c.error(`-${file.delCount}`)}`);
    lines.push('  ' + c.dim('─'.repeat(w - 2)));

    // Diff content (scrollable)
    const visible = file.lines.slice(this.scrollOffset, this.scrollOffset + visLines);
    for (const line of visible) {
      const colored =
        line.startsWith('+') && !line.startsWith('+++') ? c.success(line) :
        line.startsWith('-') && !line.startsWith('---') ? c.error(line)   :
        line.startsWith('@@')                           ? c.info(line)    :
        line.startsWith('---') || line.startsWith('+++') ? c.dim(line)     :
        c.text(line);
      lines.push('  ' + colored.slice(0, w - 2));
    }

    // Scrollbar indicator
    if (file.lines.length > visLines) {
      const scrollPct = maxScroll > 0 ? Math.floor((this.scrollOffset / maxScroll) * 100) : 0;
      lines.push('  ' + c.dim(`[${scrollPct}%] ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + visLines, file.lines.length)}/${file.lines.length}`));
    }

    // Controls
    lines.push('  ' + c.dim('─'.repeat(w - 2)));
    const navHints = this.files.length > 1
      ? `${c.dim('←→')} file  ${c.dim('↑↓')} scroll  ${c.dim('g/G')} top/bottom  ${c.dim('q')} close`
      : `${c.dim('↑↓')} scroll  ${c.dim('g/G')} top/bottom  ${c.dim('q')} close`;
    lines.push('  ' + navHints);

    // Atomic render
    const output = lines.join('\n');
    const newCount = (output.match(/\n/g) ?? []).length + 1;
    let buf = '';
    if (this.linesRendered > 0) buf += `\x1B[${this.linesRendered}A\x1B[0J`;
    buf += output;
    process.stdout.write(buf);
    this.linesRendered = newCount;
  }

  private cleanup(): void {
    if (this.onKeypress) process.stdin.removeListener('keypress', this.onKeypress);
    process.stdout.write(ANSI.showCursor);
    // Erase the viewer and print closing line
    if (this.linesRendered > 0) {
      process.stdout.write(`\x1B[${this.linesRendered}A\x1B[0J`);
    }
    process.stdout.write(`  ${c.dim('Diff viewer closed.\n')}`);
  }

  /** Quick non-interactive diff print (for /diff command) */
  static printDiff(diffText: string, maxFiles = 5, maxLinesPerFile = 40): void {
    const chunks = diffText.split(/^diff --git/m).filter(Boolean);
    if (!chunks.length) {
      console.log(`\n  ${c.muted('No changes.')}\n`);
      return;
    }

    let shown = 0;
    for (const chunk of chunks) {
      if (shown >= maxFiles) {
        console.log(`  ${c.dim(`… ${chunks.length - shown} more files`)}`);
        break;
      }

      const nameMatch = chunk.match(/a\/(.+?) b\//);
      const fileName  = nameMatch?.[1] ?? 'unknown';
      const addCount  = (chunk.match(/^\+(?!\+\+)/gm) ?? []).length;
      const delCount  = (chunk.match(/^-(?!--)/gm)    ?? []).length;

      console.log(`\n  ${c.accent.bold(fileName)}  ${c.success(`+${addCount}`)} ${c.error(`-${delCount}`)}`);
      console.log('  ' + c.dim('─'.repeat(Math.min(60, (process.stdout.columns || 80) - 4))));

      const lines = chunk.split('\n').slice(0, maxLinesPerFile);
      for (const line of lines) {
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff') || line.startsWith('index')) continue;
        if (line.startsWith('+'))       console.log('  ' + c.success(line));
        else if (line.startsWith('-'))  console.log('  ' + c.error(line));
        else if (line.startsWith('@'))  console.log('  ' + c.info(line));
        else                             console.log('  ' + c.dim(line));
      }
      shown++;
    }
    console.log('');
  }
}
