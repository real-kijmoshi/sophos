// ── Transcript — wrapped, scrollable scrollback for one TUI session ───────────
// Stores logical (styled) lines and lazily wraps them to the current width with
// an incremental cache, so streaming pushes stay O(new lines) per frame.
// scrollOffset counts wrapped rows up from the bottom; 0 = follow the tail.

import { vLen } from '../ui.js';

export class Transcript {
  private lines: string[] = [];
  private wrapped: string[] = [];
  private wrapUpto = 0;      // how many logical lines are already wrapped
  private cacheW = -1;
  scrollOffset = 0;

  /** Append a possibly multi-line styled block. */
  push(text: string): void {
    for (const l of text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
      this.lines.push(l);
    }
  }

  /** Append exactly one logical line. */
  pushRaw(line: string): void { this.lines.push(line); }

  clear(): void {
    this.lines = [];
    this.wrapped = [];
    this.wrapUpto = 0;
    this.scrollOffset = 0;
  }

  isEmpty(): boolean { return this.lines.length === 0; }

  private ensureWrapped(w: number): void {
    if (this.cacheW !== w) {
      this.wrapped = [];
      this.wrapUpto = 0;
      this.cacheW = w;
    }
    while (this.wrapUpto < this.lines.length) {
      for (const seg of wrapAnsi(this.lines[this.wrapUpto], w)) this.wrapped.push(seg);
      this.wrapUpto++;
    }
  }

  /**
   * Viewport of `h` rows at width `w`. `live` rows are pinned after the tail
   * (streaming block) and only visible while following the bottom.
   */
  view(w: number, h: number, live: string[] = []): { rows: string[]; above: number; below: number } {
    this.ensureWrapped(w);
    let all = this.wrapped;
    if (live.length && this.scrollOffset === 0) {
      const liveWrapped: string[] = [];
      for (const l of live) for (const seg of wrapAnsi(l, w)) liveWrapped.push(seg);
      all = [...this.wrapped, ...liveWrapped];
    }
    const max = Math.max(0, all.length - h);
    if (this.scrollOffset > max) this.scrollOffset = max;
    const end   = all.length - this.scrollOffset;
    const start = Math.max(0, end - h);
    const rows  = all.slice(start, end);
    while (rows.length < h) rows.push('');
    return { rows, above: start, below: this.scrollOffset };
  }

  scrollBy(delta: number, w: number, h: number): void {
    this.ensureWrapped(w);
    const max = Math.max(0, this.wrapped.length - h);
    this.scrollOffset = Math.max(0, Math.min(max, this.scrollOffset + delta));
  }

  toBottom(): void { this.scrollOffset = 0; }
}

// ── ANSI-aware hard wrap ──────────────────────────────────────────────────────
// Splits a styled line into width-sized rows. SGR color codes are carried over
// to continuation rows; non-SGR escapes are dropped. A reset clears the carry.
export function wrapAnsi(s: string, width: number): string[] {
  if (width < 4) width = 4;
  if (!s.includes('\x1B') && s.length <= width) return [s];
  if (vLen(s) <= width) return [s];

  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  let sgr: string[] = [];
  let i = 0;

  while (i < s.length) {
    if (s[i] === '\x1B') {
      const m = /^\x1B\[[0-9;]*m/.exec(s.slice(i));
      if (m) {
        cur += m[0];
        if (m[0] === '\x1B[0m' || m[0] === '\x1B[m') sgr = [];
        else sgr.push(m[0]);
        i += m[0].length;
        continue;
      }
      const skip = /^\x1B\[[0-9;?]*[A-Za-z]/.exec(s.slice(i));
      i += skip ? skip[0].length : 1;
      continue;
    }
    cur += s[i];
    curLen++;
    i++;
    if (curLen >= width && i < s.length) {
      out.push(cur);
      cur = sgr.join('');
      curLen = 0;
    }
  }
  // Trailing escape codes with no visible chars belong to the previous row,
  // not a blank extra row.
  if (curLen > 0 || out.length === 0) out.push(cur);
  else if (cur) out[out.length - 1] += cur;
  return out;
}
