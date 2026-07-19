// ── Project Store ─────────────────────────────────────────────────────────────
// Manages the `.sophos/` directory in the project root.
// Centralizes all project-scoped config, state, sessions, and logs.
//
// Structure:
//   .sophos/
//     config.json        — project settings (models, pipeline, output)
//     state/
//       pipeline.json    — last pipeline run state (for resume)
//     sessions/
//       *.json           — saved conversation sessions
//     logs/
//       *.log            — pipeline run logs (optional)

import * as fs   from 'node:fs';
import * as path from 'node:path';

export interface ProjectStorePaths {
  root:       string;  // .sophos/
  config:     string;  // .sophos/config.json
  stateDir:   string;  // .sophos/state/
  sessionsDir:string;  // .sophos/sessions/
  logsDir:    string;  // .sophos/logs/
}

export class ProjectStore {
  readonly paths: ProjectStorePaths;

  constructor(projectDir: string) {
    const root = path.join(projectDir, '.sophos');
    this.paths = {
      root,
      config:      path.join(root, 'config.json'),
      stateDir:    path.join(root, 'state'),
      sessionsDir: path.join(root, 'sessions'),
      logsDir:     path.join(root, 'logs'),
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  /** Create the .sophos/ directory tree if it doesn't exist */
  init(): void {
    for (const dir of [this.paths.root, this.paths.stateDir, this.paths.sessionsDir, this.paths.logsDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  exists(): boolean {
    return fs.existsSync(this.paths.root);
  }

  // ── Config ─────────────────────────────────────────────────────────────────
  readConfig<T = any>(): T | null {
    try {
      if (!fs.existsSync(this.paths.config)) return null;
      return JSON.parse(fs.readFileSync(this.paths.config, 'utf-8'));
    } catch {
      return null;
    }
  }

  writeConfig(data: any): void {
    this.init();
    const existing = this.readConfig() ?? {};
    deepMerge(existing, data);
    fs.writeFileSync(this.paths.config, JSON.stringify(existing, null, 2), 'utf-8');
  }

  // ── State ──────────────────────────────────────────────────────────────────
  readState(name: string): any | null {
    const fp = path.join(this.paths.stateDir, `${name}.json`);
    try {
      if (!fs.existsSync(fp)) return null;
      return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {
      return null;
    }
  }

  writeState(name: string, data: any): void {
    this.init();
    const fp = path.join(this.paths.stateDir, `${name}.json`);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
  }

  clearState(name: string): void {
    const fp = path.join(this.paths.stateDir, `${name}.json`);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* */ }
  }

  listStates(): string[] {
    try {
      return fs.readdirSync(this.paths.stateDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────
  readSession(filename: string): any | null {
    const fp = path.join(this.paths.sessionsDir, filename);
    try {
      if (!fs.existsSync(fp)) return null;
      return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {
      return null;
    }
  }

  writeSession(filename: string, data: any): void {
    this.init();
    const fp = path.join(this.paths.sessionsDir, filename);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
  }

  listSessions(): string[] {
    try {
      return fs.readdirSync(this.paths.sessionsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  // ── Logs ───────────────────────────────────────────────────────────────────
  writeLog(filename: string, content: string): void {
    this.init();
    const fp = path.join(this.paths.logsDir, filename);
    fs.writeFileSync(fp, content, 'utf-8');
  }

  listLogs(): string[] {
    try {
      return fs.readdirSync(this.paths.logsDir)
        .filter(f => f.endsWith('.log'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  /** Human-readable summary of the .sophos/ directory */
  formatSummary(): string {
    const exists = this.exists();
    const config = this.readConfig();
    const states = this.listStates();
    const sessions = this.listSessions();
    const logs = this.listLogs();

    const lines: string[] = [];
    lines.push(`  ${exists ? '●' : '○'} ${exists ? '.sophos/' : '.sophos/ (not initialized)'}`);
    if (config) lines.push(`    config:    ${Object.keys(config).join(', ')}`);
    lines.push(`    state:     ${states.length} file${states.length !== 1 ? 's' : ''} (${states.join(', ') || 'empty'})`);
    lines.push(`    sessions:  ${sessions.length} saved`);
    lines.push(`    logs:      ${logs.length} run${logs.length !== 1 ? 's' : ''}`);
    return lines.join('\n');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function deepMerge(target: any, source: any): void {
  for (const key of Object.keys(source ?? {})) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
}
