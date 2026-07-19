// ── FileIndex — cached repo file list for @-mention completion ────────────────
// Walks the project once (async, capped) and serves fuzzy path matches to the
// command palette. The scan is lazy — first "@" triggers it — and the cache
// goes stale after a short TTL so new files show up without a restart.

import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'target',
  '.sophos', '.claude', '__pycache__', '.next', '.nuxt', '.venv', 'venv',
]);
const MAX_FILES = 5000;
const STALE_MS  = 30_000;

export class FileIndex {
  private files: string[] = [];
  private scannedAt = 0;
  private scanning: Promise<void> | null = null;

  constructor(private rootDir: string) {}

  /** Kick off (or join) a scan. Resolves when the index is fresh. */
  refresh(): Promise<void> {
    if (Date.now() - this.scannedAt < STALE_MS) return Promise.resolve();
    if (!this.scanning) {
      this.scanning = this.scan()
        .catch(() => {})
        .finally(() => { this.scanning = null; });
    }
    return this.scanning;
  }

  /**
   * Fuzzy-match repo-relative paths (forward slashes). Basename prefix beats
   * path substring beats subsequence; shallower paths win ties.
   */
  match(query: string, limit = 8): string[] {
    const q = query.toLowerCase();
    if (!q) {
      return [...this.files]
        .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
        .slice(0, limit);
    }
    const scored: Array<{ file: string; score: number }> = [];
    for (const file of this.files) {
      const lower = file.toLowerCase();
      const base  = path.posix.basename(lower);
      let score = -1;
      if (base.startsWith(q))            score = 0;
      else if (base.includes(q))         score = 10;
      else if (lower.includes(q))        score = 20;
      else if (isSubsequence(q, lower))  score = 30;
      if (score < 0) continue;
      scored.push({ file, score });
    }
    scored.sort((a, b) =>
      a.score - b.score || depth(a.file) - depth(b.file) || a.file.localeCompare(b.file));
    return scored.slice(0, limit).map(s => s.file);
  }

  private async scan(): Promise<void> {
    const found: string[] = [];
    const queue: string[] = [''];
    while (queue.length && found.length < MAX_FILES) {
      const rel = queue.shift()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(path.join(this.rootDir, rel), { withFileTypes: true });
      } catch { continue; }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name)) queue.push(childRel);
        } else if (e.isFile()) {
          found.push(childRel);
          if (found.length >= MAX_FILES) break;
        }
      }
    }
    this.files = found;
    this.scannedAt = Date.now();
  }
}

function depth(p: string): number {
  let n = 0;
  for (const ch of p) if (ch === '/') n++;
  return n;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
