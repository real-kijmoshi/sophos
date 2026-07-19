// ── Phase Renderer v4.0 — Claude Code-style minimal display ───────────────────
// Minimal, information-dense pipeline display with inline streaming tokens.
// Completed phases collapse to a single line. Running phases show live output.

import {
  phaseLine, phaseCard, toolCallCard, taskGrid,
  formatDuration, shimmerText, phaseDots, pipelineHint,
  type PhaseCardStatus, type TaskRow, c, W, vLen,
} from './ui.js';
import { FRAMES } from './spinner-frames.js';

export interface PhaseState {
  id:          string;
  number:      number;
  name:        string;
  status:      PhaseCardStatus;
  lines:       string[];
  stream:      string;
  streamAgent: string;
  collapsed:   boolean;
  startMs?:    number;
  durationMs?: number;
  tokenCount:  number;
  dirty:       boolean;
  aborted:     boolean;
  toolCalls:   ToolCall[];
}

export interface ToolCall {
  name:       string;
  status:     'running' | 'done' | 'failed';
  detail?:    string;
  startMs:    number;
  durationMs?: number;
}

export interface PhaseEvent {
  type:
    | 'phase_start' | 'phase_line' | 'phase_done'
    | 'phase_fail'  | 'task_update' | 'llm_token'
    | 'tool_start'  | 'tool_done'   | 'tool_fail';
  phaseId?:    string;
  line?:       string;
  taskRow?:    TaskRow;
  durationMs?: number;
  token?:      string;
  agentName?:  string;
  toolName?:   string;
  toolDetail?: string;
}

const PHASE_ORDER = [
  'repository-analysis', 'planning-swarm',    'execution-planning',
  'coding-swarm',        'multi-agent-review', 'automated-validation',
  'security-swarm',      'integration',        'final-qa',
] as const;

const PHASE_NAMES: Record<string, string> = {
  'repository-analysis':  'Repository Analysis',
  'planning-swarm':       'Planning Swarm',
  'execution-planning':   'Execution Planning',
  'coding-swarm':         'Coding Swarm',
  'multi-agent-review':   'Multi-Agent Review',
  'automated-validation': 'Automated Validation',
  'security-swarm':       'Security Swarm',
  'integration':          'Integration',
  'final-qa':             'Final QA',
};

const FRAME_MS      = 80;
const AUTO_COLLAPSE = 2000;
const STREAM_COLS   = 80;
const STREAM_ROWS   = 4;
const TPS_WINDOW_MS = 5000;
const ETA_SAMPLES   = 3;

export class PhaseRenderer {
  private phases:         Map<string, PhaseState> = new Map();
  private tasks:          Map<string, TaskRow>    = new Map();
  private linesRendered   = 0;
  private pipelineStart   = Date.now();
  private collapseTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private renderTimer:    ReturnType<typeof setInterval> | null = null;
  private dirty           = false;
  private spinFrame       = 0;
  private tick            = 0;   // unbounded — drives the shimmer sweep
  private currentRequest  = '';
  private tokenTimestamps: number[] = [];
  private selectedIndex   = -1;  // keyboard-selected phase row (-1 = none)

  constructor() { this.initPhases(); }

  begin(): void {
    process.stdout.write('\x1B[?25l');
    this.render();
    this.renderTimer = setInterval(() => {
      if (this.dirty || this.hasRunning()) {
        this.render();
        this.dirty = false;
      }
      this.spinFrame = (this.spinFrame + 1) % FRAMES.length;
      this.tick++;
    }, FRAME_MS);
  }

  stop(): void {
    if (this.renderTimer) { clearInterval(this.renderTimer); this.renderTimer = null; }
  }

  reset(): void {
    this.stop();
    for (const t of this.collapseTimers.values()) clearTimeout(t);
    this.collapseTimers.clear();
    this.phases.clear();
    this.tasks.clear();
    this.linesRendered   = 0;
    this.pipelineStart   = Date.now();
    this.spinFrame       = 0;
    this.tick            = 0;
    this.dirty           = false;
    this.currentRequest  = '';
    this.tokenTimestamps = [];
    this.selectedIndex   = -1;
    this.initPhases();
  }

  finalize(): void {
    this.stop();
    this.render();
    process.stdout.write('\n');
    this.linesRendered = 0;
    process.stdout.write('\x1B[?25h');
  }

  setRequest(text: string): void { this.currentRequest = text; this.dirty = true; }

  onEvent(event: PhaseEvent): void {
    switch (event.type) {
      case 'phase_start': {
        const p = this.phases.get(event.phaseId!);
        if (p) {
          p.status = 'running'; p.collapsed = false;
          p.startMs = Date.now(); p.stream = ''; p.dirty = true;
          p.toolCalls = [];
          const t = this.collapseTimers.get(event.phaseId!);
          if (t) clearTimeout(t);
        }
        break;
      }
      case 'phase_line': {
        const p = this.phases.get(event.phaseId!);
        if (p && event.line) {
          p.lines.push(event.line);
          if (p.lines.length > 12) p.lines = p.lines.slice(-12);
          p.stream = ''; p.dirty = true;
        }
        break;
      }
      case 'llm_token': {
        // Use the explicitly provided phaseId first, fall back to whichever phase is running
        const target = (event.phaseId ? this.phases.get(event.phaseId) : undefined)
          ?? this.getActivePhase();
        if (target) {
          target.tokenCount++;
          target.streamAgent = event.agentName ?? '';
          target.stream = appendToken(target.stream, event.token ?? '');
          target.dirty = true;
          const now = Date.now();
          this.tokenTimestamps.push(now);
          const cutoff = now - TPS_WINDOW_MS;
          while (this.tokenTimestamps.length && this.tokenTimestamps[0] < cutoff)
            this.tokenTimestamps.shift();
        }
        break;
      }
      case 'tool_start': {
        const p = this.phases.get(event.phaseId!);
        if (p && event.toolName) {
          p.toolCalls.push({
            name:    event.toolName,
            status:  'running',
            detail:  event.toolDetail,
            startMs: Date.now(),
          });
          p.dirty = true;
        }
        break;
      }
      case 'tool_done': {
        const p = this.phases.get(event.phaseId!);
        if (p && event.toolName) {
          const tc = p.toolCalls.find(t => t.name === event.toolName && t.status === 'running');
          if (tc) { tc.status = 'done'; tc.durationMs = Date.now() - tc.startMs; }
          p.dirty = true;
        }
        break;
      }
      case 'tool_fail': {
        const p = this.phases.get(event.phaseId!);
        if (p && event.toolName) {
          const tc = p.toolCalls.find(t => t.name === event.toolName && t.status === 'running');
          if (tc) { tc.status = 'failed'; tc.durationMs = Date.now() - tc.startMs; }
          p.dirty = true;
        }
        break;
      }
      case 'phase_done': {
        const p = this.phases.get(event.phaseId!);
        if (p) {
          p.status = 'passed';
          p.durationMs = event.durationMs ?? (p.startMs ? Date.now() - p.startMs : 0);
          p.stream = ''; p.dirty = true;
          // Collapse completed phase after delay
          const id = event.phaseId!;
          const t = setTimeout(() => {
            const pp = this.phases.get(id);
            if (pp) { pp.collapsed = true; pp.dirty = true; this.dirty = true; }
          }, AUTO_COLLAPSE);
          this.collapseTimers.set(id, t);
        }
        break;
      }
      case 'phase_fail': {
        const p = this.phases.get(event.phaseId!);
        if (p) {
          p.status = 'failed'; p.collapsed = false;
          p.durationMs = event.durationMs ?? (p.startMs ? Date.now() - p.startMs : 0);
          p.stream = ''; p.dirty = true;
        }
        break;
      }
      case 'task_update': {
        if (event.taskRow) this.tasks.set(event.taskRow.id, event.taskRow);
        break;
      }
    }
    this.dirty = true;
    if (!this.renderTimer) this.render();
  }

  render(): void {
    const w     = W();
    const lines: string[] = [''];

    // ── Request header (minimal) ────────────────────────────────────────────
    if (this.currentRequest) {
      const req = this.currentRequest.length > w - 16
        ? this.currentRequest.slice(0, w - 19) + '…'
        : this.currentRequest;
      lines.push(`  ${c.primary('◆')} ${c.text(req)}`);
      lines.push('');
    }

    // ── Live status header — shimmer on the active phase name ───────────────
    const all     = [...this.phases.values()];
    const total   = PHASE_ORDER.length;
    const done    = all.filter(p => p.status === 'passed').length;
    const failed  = all.filter(p => p.status === 'failed').length;
    const running = all.filter(p => p.status === 'running');
    const elapsed = formatDuration(Date.now() - this.pipelineStart);

    const tps = this.tokenTimestamps.length > 1
      ? Math.round((this.tokenTimestamps.length / TPS_WINDOW_MS) * 1000)
      : 0;
    const eta = this.getETA();

    const spin  = c.primary(FRAMES[this.spinFrame]);
    const title = running.length
      ? shimmerText(`${running[0].name}…`, this.tick >> 1)
      : failed         ? c.error('failed')
      : done === total ? c.success('complete')
      : c.dim('starting…');
    const meta = [
      c.dim(elapsed),
      tps > 0 ? c.dim(`${tps} tok/s`) : '',
      eta     ? c.dim(`${eta} left`)  : '',
    ].filter(Boolean).join(c.dim(' · '));
    lines.push(`  ${spin} ${title}  ${meta}`);

    // Dots mini-map + counter, esc hint right-aligned
    const dots    = phaseDots(all.map(p => p.status));
    const counter = c.dim(`${done}/${total}`) + (failed ? c.error(` ${failed}✗`) : '');
    const escHint = c.dim('esc to interrupt');
    const dotsLeft = `  ${dots}  ${counter}`;
    const gap      = Math.max(2, w - vLen(dotsLeft) - vLen(escHint) - 2);
    lines.push(dotsLeft + ' '.repeat(gap) + escHint);
    lines.push('');

    // ── Phase list — minimal Claude Code style ──────────────────────────────
    const sel = (idx: number, s: string): string =>
      idx === this.selectedIndex ? s.replace(/^  /, c.accent('❯ ')) : s;

    for (let idx = 0; idx < all.length; idx++) {
      const phase = all[idx];
      if (phase.status === 'pending') {
        // Pending: just a dim dot + name
        lines.push(sel(idx, `  ${c.dim('○')} ${c.dim(String(phase.number))}  ${c.dim(phase.name)}`));
        continue;
      }

      if (phase.status === 'passed' && phase.collapsed) {
        // Completed & collapsed: single line ✓
        lines.push(sel(idx, phaseLine({
          number:     phase.number,
          name:       phase.name,
          status:     'passed',
          durationMs: phase.durationMs,
        })));
        continue;
      }

      if (phase.status === 'failed' || phase.aborted) {
        // Failed: show with lines
        lines.push(sel(idx, phaseCard({
          number:     phase.number,
          name:       phase.name,
          status:     phase.status,
          lines:      phase.lines,
          collapsed:  false,
          durationMs: phase.durationMs,
          aborted:    phase.aborted,
        })));
        continue;
      }

      // Running phase: show full card with streaming output
      const isRunning = phase.status === 'running';
      let displayLines: string[] = [];

      if (isRunning) {
        // Spinner + elapsed + tokens
        const spin = c.primary(FRAMES[this.spinFrame]);
        const live = c.dim(formatDuration(Date.now() - (phase.startMs ?? Date.now())));
        const toks = phase.tokenCount > 0 ? c.dim(` ${phase.tokenCount}tok`) : '';
        const agent = phase.streamAgent ? c.dim(` ${phase.streamAgent}`) : '';
        displayLines.push(`${spin} ${live}${toks}${agent}`);

        // Live streaming tokens (Claude Code style)
        if (phase.stream) {
          for (const sl of phase.stream.split('\n').slice(-STREAM_ROWS)) {
            if (sl.trim()) displayLines.push(c.text(sl));
          }
        }

        // Tool calls (if any)
        for (const tc of phase.toolCalls.slice(-3)) {
          displayLines.push(toolCallCard({
            name:       tc.name,
            status:     tc.status,
            detail:     tc.detail,
            durationMs: tc.durationMs,
            collapsed:  tc.status !== 'running',
          }).split('\n')[0]); // Just the header line
        }
      }

      lines.push(sel(idx, phaseCard({
        number:     phase.number,
        name:       phase.name,
        status:     phase.status,
        lines:      displayLines.length ? displayLines : phase.lines,
        collapsed:  false,
        durationMs: phase.durationMs,
      })));
    }

    // ── Task grid (compact) ─────────────────────────────────────────────────
    if (this.tasks.size > 0) {
      const activeTasks = [...this.tasks.values()].filter(t => t.status !== 'done');
      if (activeTasks.length > 0) {
        lines.push('');
        lines.push(taskGrid(activeTasks));
      }
    }

    // Keyboard hint lives inside the live region so repaints stay aligned.
    // Omitted on the final paint (finalize() stops the timer first).
    if (this.renderTimer) {
      lines.push('');
      lines.push(pipelineHint());
    }
    lines.push('');

    // ── Atomic write ────────────────────────────────────────────────────────
    const output       = lines.join('\n');
    const newLineCount = (output.match(/\n/g) ?? []).length + 1;
    let   buf          = '';
    if (this.linesRendered > 0) buf += `\x1B[${this.linesRendered}A\x1B[0J`;
    buf += output;
    process.stdout.write(buf);
    this.linesRendered = newLineCount;
  }

  // ── Public getters ──────────────────────────────────────────────────────────

  getActivePhase(): PhaseState | undefined {
    return [...this.phases.values()].find(p => p.status === 'running');
  }

  getPhase(id: string): PhaseState | undefined { return this.phases.get(id); }

  getTaskList(): TaskRow[] { return [...this.tasks.values()]; }

  toggleCollapse(id: string): void {
    const p = this.phases.get(id);
    if (p) { p.collapsed = !p.collapsed; this.dirty = true; }
  }

  /** Highlight a phase row (keyboard navigation). Pass -1 to clear. */
  setSelected(index: number): void {
    this.selectedIndex = Math.max(-1, Math.min(this.phases.size - 1, index));
    this.dirty = true;
  }

  getSelected(): number { return this.selectedIndex; }

  expandAll(): void {
    for (const p of this.phases.values()) { p.collapsed = false; p.dirty = true; }
    this.dirty = true;
  }

  collapseAll(): void {
    for (const p of this.phases.values()) {
      if (p.status !== 'running') { p.collapsed = true; p.dirty = true; }
    }
    this.dirty = true;
  }

  abort(): void {
    const active = this.getActivePhase();
    if (active) {
      active.status  = 'failed';
      active.aborted = true;
      active.durationMs = active.startMs ? Date.now() - active.startMs : 0;
      active.collapsed = false;
      active.dirty = true;
    }
    this.dirty = true;
    if (!this.renderTimer) this.render();
  }

  getSummary(): { done: number; failed: number; total: number; filesChanged: number } {
    const arr = [...this.phases.values()];
    return {
      done:   arr.filter(p => p.status === 'passed').length,
      failed: arr.filter(p => p.status === 'failed').length,
      total:  arr.length,
      filesChanged: 0,
    };
  }

  getETA(): string | null {
    const completed = [...this.phases.values()].filter(p => p.durationMs && p.status === 'passed');
    if (completed.length < ETA_SAMPLES) return null;

    const avgDuration = completed.reduce((sum, p) => sum + (p.durationMs ?? 0), 0) / completed.length;
    const remaining = [...this.phases.values()].filter(p => p.status === 'pending' || p.status === 'running').length;
    const etaMs = avgDuration * remaining;

    if (etaMs < 1000) return '<1s';
    if (etaMs < 60000) return `~${Math.round(etaMs / 1000)}s`;
    return `~${Math.floor(etaMs / 60000)}m${Math.floor((etaMs % 60000) / 1000)}s`;
  }

  isPhaseExpanded(id: string): boolean {
    const p = this.phases.get(id);
    return p ? !p.collapsed : false;
  }

  initPhases(): void {
    PHASE_ORDER.forEach((id, idx) => {
      this.phases.set(id, {
        id, number: idx + 1, name: PHASE_NAMES[id] ?? id,
        status: 'pending', lines: [], stream: '', streamAgent: '',
        collapsed: true, tokenCount: 0, dirty: false, aborted: false,
        toolCalls: [],
      });
    });
  }

  private hasRunning(): boolean {
    return [...this.phases.values()].some(p => p.status === 'running');
  }
}

function appendToken(stream: string, token: string): string {
  let s     = stream + token;
  const ls  = s.split('\n');
  const last = ls[ls.length - 1];
  if (last.length > STREAM_COLS) {
    const cut = last.lastIndexOf(' ', STREAM_COLS);
    if (cut > 0) {
      ls[ls.length - 1] = last.slice(0, cut);
      ls.push(last.slice(cut + 1));
    }
  }
  return ls.slice(-STREAM_ROWS).join('\n');
}

export const phaseRenderer = new PhaseRenderer();
