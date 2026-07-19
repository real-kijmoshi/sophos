// ── Pipeline State ─────────────────────────────────────────────────────────────
// Saves and restores pipeline state so interrupted pipelines can be resumed.
// Now uses project store (.sophos/state/) with fallback to global config dir.

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as os   from 'node:os';
import { ProjectStore } from '../config/project-store.js';

interface PipelineState {
  request:    string;
  targetDir:  string;
  planOnly:   boolean;
  model?:     string;
  startedAt:  number;
  completedAt?: number;
  success?:    boolean;
  phases:     { name: string; status: string; durationMs?: number }[];
  deliverables?: any;
}

// ── Project-scoped paths ─────────────────────────────────────────────────────
let projectStore: ProjectStore | null = null;

export function setProjectStore(store: ProjectStore): void {
  projectStore = store;
}

// ── Legacy global paths ──────────────────────────────────────────────────────
const LEGACY_DIR    = path.join(os.homedir(), '.config', 'sophos');
const LEGACY_FILE   = path.join(LEGACY_DIR, 'pipeline-state.json');

function getProjectFile(): string | null {
  if (projectStore) return path.join(projectStore.paths.stateDir, 'pipeline.json');
  return null;
}

function ensureDir(): void {
  if (!fs.existsSync(LEGACY_DIR)) fs.mkdirSync(LEGACY_DIR, { recursive: true });
}

// ── Save ──────────────────────────────────────────────────────────────────────
export function savePipelineState(state: PipelineState): void {
  // Prefer project store
  const pf = getProjectFile();
  if (pf) {
    const dir = path.dirname(pf);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pf, JSON.stringify(state, null, 2), 'utf-8');
    return;
  }
  // Fallback to global
  ensureDir();
  fs.writeFileSync(LEGACY_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ── Load ──────────────────────────────────────────────────────────────────────
export function loadPipelineState(): PipelineState | null {
  // Try project store first
  const pf = getProjectFile();
  if (pf) {
    try {
      if (fs.existsSync(pf)) return JSON.parse(fs.readFileSync(pf, 'utf-8'));
    } catch { /* */ }
    return null;
  }
  // Fallback to global
  try {
    if (!fs.existsSync(LEGACY_FILE)) return null;
    return JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Clear ─────────────────────────────────────────────────────────────────────
export function clearPipelineState(): void {
  const pf = getProjectFile();
  if (pf) {
    try { if (fs.existsSync(pf)) fs.unlinkSync(pf); } catch { /* */ }
    return;
  }
  try { if (fs.existsSync(LEGACY_FILE)) fs.unlinkSync(LEGACY_FILE); } catch { /* */ }
}

// ── Format ────────────────────────────────────────────────────────────────────
export function formatPipelineState(state: PipelineState): string {
  const elapsed = state.completedAt
    ? state.completedAt - state.startedAt
    : Date.now() - state.startedAt;

  const parts = [
    `request:  ${state.request}`,
    `target:   ${state.targetDir}`,
    `plan:     ${state.planOnly ? 'yes' : 'no'}`,
    `elapsed:  ${formatMs(elapsed)}`,
    `status:   ${state.success === true ? 'completed' : state.success === false ? 'failed' : 'interrupted'}`,
  ];

  if (state.phases?.length) {
    const done = state.phases.filter(p => p.status === 'passed').length;
    parts.push(`phases:   ${done}/${state.phases.length} completed`);
  }

  return parts.join('\n');
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
