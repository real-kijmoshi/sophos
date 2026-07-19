// ── HistoryStore — persistent prompt history across restarts ──────────────────
// Loads .sophos/history.json when the project has a .sophos/ store, falling
// back to ~/.config/sophos/history.json. Saves are best-effort write-through;
// the file is capped so it never grows unbounded.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const MAX_ENTRIES = 200;

export class HistoryStore {
  private file: string;

  constructor(projectDir: string) {
    const projectStore = path.join(projectDir, '.sophos');
    this.file = fs.existsSync(projectStore)
      ? path.join(projectStore, 'history.json')
      : path.join(os.homedir(), '.config', 'sophos', 'history.json');
  }

  /** Load persisted history, oldest first. Returns [] when none exists. */
  load(): string[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      if (Array.isArray(raw)) {
        return raw.filter((e): e is string => typeof e === 'string').slice(-MAX_ENTRIES);
      }
    } catch { /* no history yet */ }
    return [];
  }

  /** Persist the full history list. Called after each submit. */
  save(history: string[]): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(history.slice(-MAX_ENTRIES), null, 2), 'utf-8');
    } catch { /* persistence is best-effort — never break the prompt over it */ }
  }
}
