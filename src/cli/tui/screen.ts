// ── Screen — alternate-buffer terminal surface with diffed row repaints ───────
// Owns the full terminal: enters the alternate screen buffer on enter(), and
// repaints frames via render(rows). Only rows whose content changed since the
// previous frame are rewritten (absolute positioning), so a keystroke normally
// costs one row write. exit()/suspend() restore the user's normal buffer.

import { truncateAnsi } from '../editor.js';

export class Screen {
  private prev: string[] = [];
  private active = false;
  private resizeFn: (() => void) | null = null;

  // Real stdout writer, bound at construction — the TUI app later intercepts
  // process.stdout.write globally (console.log in Bun bypasses it otherwise),
  // and the Screen must keep painting through the real one.
  private out: (s: string) => void = process.stdout.write.bind(process.stdout);

  get cols(): number { return process.stdout.columns || 80; }
  get rows(): number { return process.stdout.rows || 24; }

  enter(): void {
    if (this.active) return;
    this.active = true;
    // Alt buffer + clear + home + hide cursor (shown per-frame at input position)
    this.out('\x1B[?1049h\x1B[2J\x1B[H\x1B[?25l');
    this.prev = [];
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.out('\x1B[?1049l\x1B[?25h');
  }

  isActive(): boolean { return this.active; }

  /** Force the next render to repaint every row (resize, returning from suspend). */
  invalidate(): void { this.prev = []; }

  onResize(cb: () => void): void {
    this.resizeFn = () => { this.invalidate(); cb(); };
    process.stdout.on('resize', this.resizeFn);
  }

  destroy(): void {
    if (this.resizeFn) { process.stdout.removeListener('resize', this.resizeFn); this.resizeFn = null; }
    this.exit();
  }

  /**
   * Paint a frame. `rows` are logical lines top to bottom (truncated to width).
   * `cursor` places the hardware cursor (0-based row/col) — null keeps it hidden.
   */
  render(rows: string[], cursor: { row: number; col: number } | null): void {
    if (!this.active) return;
    const w = this.cols;
    const h = this.rows;
    let buf = '\x1B[?25l';
    for (let r = 0; r < h; r++) {
      const line = rows[r] ?? '';
      if (this.prev[r] === line) continue;
      buf += `\x1B[${r + 1};1H\x1B[2K` + truncateAnsi(line, w);
      this.prev[r] = line;
    }
    this.prev.length = h;
    if (cursor) {
      const row = Math.max(0, Math.min(h - 1, cursor.row));
      const col = Math.max(0, Math.min(w - 1, cursor.col));
      buf += `\x1B[${row + 1};${col + 1}H\x1B[?25h`;
    }
    if (buf !== '\x1B[?25l' || cursor) this.out(buf);
  }
}
