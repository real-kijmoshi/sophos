// ── Interactive File Browser ───────────────────────────────────────────────────
// Navigate project files with arrow keys, preview content, see diffs.
// Inspired by Claude Code / Grok Code file navigation.

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { c, W, ANSI } from './ui.js';

export interface FileEntry {
  name:     string;
  path:     string;
  isDir:    boolean;
  size:     number;
  modified: Date;
}

export interface BrowserResult {
  selected?: string;
  action:    'open' | 'preview' | 'diff' | 'cancel';
}

export class FileBrowser {
  private cwd:         string;
  private entries:     FileEntry[] = [];
  private dirError:    string | null = null;
  private cursor:      number = 0;
  private scroll:      number = 0;
  private history:     string[] = [];
  private rl:          readline.Interface | null = null;
  private linesRendered = 0;
  private previewContent: string | null = null;
  private previewFile:    string | null = null;

  constructor(startDir: string) {
    this.cwd = startDir;
    this.loadDir();
  }

  async show(): Promise<BrowserResult> {
    return new Promise((resolve) => {
      process.stdout.write(ANSI.clearScreen);
      this.render();
      this.startInput(resolve);
    });
  }

  private loadDir(): void {
    this.dirError = null;
    try {
      const raw = fs.readdirSync(this.cwd, { withFileTypes: true });
      this.entries = raw
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => {
          const full = path.join(this.cwd, e.name);
          try {
            const stat = fs.statSync(full);
            return { name: e.name, path: full, isDir: e.isDirectory(), size: stat.size, modified: stat.mtime };
          } catch {
            return { name: e.name, path: full, isDir: e.isDirectory(), size: 0, modified: new Date() };
          }
        })
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      this.cursor = 0;
      this.scroll = 0;
      this.previewContent = null;
      this.previewFile = null;
    } catch (err: any) {
      this.entries = [];
      this.dirError = err.message || 'Cannot read directory';
    }
  }

  private render(): void {
    const w = W();
    const lines: string[] = [];

    // Header
    const rel = this.cwd.replace(process.env.HOME ?? '', '~');
    lines.push(`  ${c.primary.bold('◆')} ${c.accent('Files')}  ${c.dim(rel)}`);
    lines.push('  ' + c.dim('─'.repeat(w - 4)));
    lines.push('');

    // Breadcrumb
    const parts = this.cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    const breadcrumb = parts.map((p, i) => {
      const isLast = i === parts.length - 1;
      return isLast ? c.accent.bold(p) : c.dim(p);
    }).join(c.dim(' › '));
    lines.push(`  ${breadcrumb}`);
    lines.push('');

    // File list
    if (this.dirError) {
      lines.push(`  ${c.error('⚠')}  ${c.error(this.dirError)}`);
      lines.push(`  ${c.dim('Press Esc to go back.')}`);
    } else {
      const visibleCount = Math.min(this.entries.length, 20);
      for (let i = 0; i < visibleCount; i++) {
        const e = this.entries[i];
        const isSelected = i === this.cursor;
        const prefix = isSelected ? c.primary('▸') : ' ';
        const icon = e.isDir ? c.primary('📁') : c.dim('📄');
        const name = e.isDir ? c.accent.bold(e.name + '/') : c.text(e.name);
        const size = e.isDir ? '' : c.dim(formatSize(e.size));

        lines.push(`  ${prefix} ${icon} ${name} ${size}`);
      }

      if (this.entries.length > 20) {
        lines.push(c.dim(`    … ${this.entries.length - 20} more`));
      }

      // Preview pane
      if (this.previewContent) {
        lines.push('');
        lines.push('  ' + c.dim('─'.repeat(w - 4)));
        lines.push(`  ${c.accent('Preview:')} ${c.dim(this.previewFile ?? '')}`);
        lines.push('');
        const previewLines = this.previewContent.split('\n').slice(0, 15);
        for (const pl of previewLines) {
          lines.push(`  ${c.text(pl.slice(0, w - 4))}`);
        }
        if (this.previewContent.split('\n').length > 15) {
          lines.push(c.dim(`    … ${this.previewContent.split('\n').length - 15} more lines`));
        }
      }
    }

    // Status bar
    lines.push('');
    lines.push('  ' + c.dim('─'.repeat(w - 4)));
    lines.push(`  ${c.dim('↑↓')} navigate  ${c.dim('Enter')} open  ${c.dim('p')} preview  ${c.dim('Esc')} back`);

    // Atomic write
    const output = lines.join('\n');
    const newLineCount = (output.match(/\n/g) ?? []).length + 1;
    let buf = '';
    if (this.linesRendered > 0) buf += `\x1B[${this.linesRendered}A\x1B[0J`;
    buf += output;
    process.stdout.write(buf);
    this.linesRendered = newLineCount;
  }

  private startInput(resolve: (result: BrowserResult) => void): void {
    process.stdout.write(ANSI.hideCursor);

    const onKeypress = (_str: string, key: any) => {
      if (!key) return;

      switch (key.name) {
        case 'up':
          this.cursor = Math.max(0, this.cursor - 1);
          this.ensureVisible();
          this.render();
          break;
        case 'down':
          this.cursor = Math.min(this.entries.length - 1, this.cursor + 1);
          this.ensureVisible();
          this.render();
          break;
        case 'return':
          this.cleanup();
          const entry = this.entries[this.cursor];
          if (entry?.isDir) {
            this.history.push(this.cwd);
            this.cwd = entry.path;
            this.loadDir();
            this.render();
            this.startInput(resolve);
          } else {
            resolve({ selected: entry?.path, action: 'open' });
          }
          break;
        case 'p':
          this.togglePreview();
          this.render();
          break;
        case 'escape':
        case 'q':
          if (this.history.length > 0) {
            this.cwd = this.history.pop()!;
            this.loadDir();
            this.render();
            this.startInput(resolve);
          } else {
            this.cleanup();
            resolve({ action: 'cancel' });
          }
          break;
        case 'backspace':
          if (this.history.length > 0) {
            this.cwd = this.history.pop()!;
            this.loadDir();
            this.render();
            this.startInput(resolve);
          }
          break;
      }
    };

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKeypress);

    // Store cleanup function
    this._cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
    };
  }

  private _cleanup: (() => void) | null = null;

  private cleanup(): void {
    this._cleanup?.();
    process.stdout.write(ANSI.showCursor);
    if (this.linesRendered > 0) {
      process.stdout.write(`\x1B[${this.linesRendered}A\x1B[0J`);
    }
    this.linesRendered = 0;
  }

  private ensureVisible(): void {
    const maxVisible = 20;
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    if (this.cursor >= this.scroll + maxVisible) this.scroll = this.cursor - maxVisible + 1;
  }

  private togglePreview(): void {
    const entry = this.entries[this.cursor];
    if (!entry || entry.isDir) { this.previewContent = null; return; }

    if (this.previewFile === entry.path) {
      this.previewContent = null;
      this.previewFile = null;
      return;
    }

    try {
      const content = fs.readFileSync(entry.path, 'utf-8');
      this.previewContent = content;
      this.previewFile = entry.path;
    } catch {
      this.previewContent = '(binary or unreadable)';
      this.previewFile = entry.path;
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Quick file picker (lightweight version) ───────────────────────────────────
// Fuzzy file search — type to filter, Enter to select.

export class FilePicker {
  static async pick(dir: string, filter?: string): Promise<string | null> {
    const entries = scanFiles(dir, filter);
    if (entries.length === 0) return null;
    if (entries.length === 1) return entries[0];

    return new Promise((resolve) => {
      let cursor = 0;
      let query = '';
      let filtered = entries;
      let linesRendered = 0;

      const render = () => {
        const w = W();
        const lines: string[] = [];
        lines.push(`  ${c.accent('Select file:')} ${c.text(query)}${c.dim('█')}`);
        lines.push('');

        const visible = filtered.slice(0, 15);
        for (let i = 0; i < visible.length; i++) {
          const prefix = i === cursor ? c.primary('▸') : ' ';
          const name = visible[i].replace(dir, '').replace(/\\/g, '/').slice(1);
          lines.push(`  ${prefix} ${c.text(name)}`);
        }

        lines.push('');
        lines.push(`  ${c.dim('↑↓')} select  ${c.dim('Enter')} confirm  ${c.dim('Esc')} cancel`);

        const output = lines.join('\n');
        const newLineCount = (output.match(/\n/g) ?? []).length + 1;
        let buf = '';
        if (linesRendered > 0) buf += `\x1B[${linesRendered}A\x1B[0J`;
        buf += output;
        process.stdout.write(buf);
        linesRendered = newLineCount;
      };

      const onKeypress = (_str: string, key: any) => {
        if (!key) return;
        if (key.name === 'up')   cursor = Math.max(0, cursor - 1);
        if (key.name === 'down') cursor = Math.min(filtered.length - 1, cursor + 1);
        if (key.name === 'escape' || key.name === 'q') {
          cleanup();
          resolve(null);
          return;
        }
        if (key.name === 'return') {
          cleanup();
          resolve(filtered[cursor] ?? null);
          return;
        }
        if (key.name === 'backspace') {
          query = query.slice(0, -1);
        } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          query += key.sequence;
        }
        filtered = entries.filter(e => e.toLowerCase().includes(query.toLowerCase()));
        cursor = Math.min(cursor, filtered.length - 1);
        render();
      };

      const cleanup = () => {
        process.stdin.removeListener('keypress', onKeypress);
        process.stdout.write(ANSI.showCursor);
        if (linesRendered > 0) process.stdout.write(`\x1B[${linesRendered}A\x1B[0J`);
      };

      process.stdout.write(ANSI.hideCursor);
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('keypress', onKeypress);
      render();
    });
  }
}

function scanFiles(dir: string, filter?: string): string[] {
  const results: string[] = [];
  const ignore = ['node_modules', '.git', 'dist', '__pycache__', '.next', '.sophos'];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (ignore.includes(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(...scanFiles(full, filter));
      } else {
        if (!filter || e.name.includes(filter)) {
          results.push(full);
        }
      }
    }
  } catch { /* */ }

  return results.slice(0, 100);
}
