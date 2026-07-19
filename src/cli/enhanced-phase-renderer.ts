// ── Enhanced Phase Renderer v2.0 ──────────────────────────────────────────────
// Frontier-grade pipeline display with structured logging, progress indicators,
// and clean formatting inspired by Claude Code and Grok Code

import {
  c, getTerminalWidth, stripAnsi, truncate, wordWrap,
  createDivider, createSection, createBadge, createProgressBar,
  createPhaseDisplay, createTaskGrid, createStreamingOutput, createCard
} from './modern-ui.js';

// Import legacy UI for compatibility
import {
  phaseCard, phaseLine, progressBar, banner, statusBar,
  welcomeCard, helpPanel, errorCard, shipItPanel, cancelCard,
  actionsBar, suggestionsBar, confirmPrompt, classifyError,
  gradientText, shimmerText, asciiLogo, type PhaseCardStatus
} from './ui.js';

import { FRAMES } from './spinner-frames.js';

// ── Types ────────────────────────────────────────────────────────────────────
export interface EnhancedPhaseEvent {
  type: 'phase_start' | 'phase_line' | 'phase_done' | 'phase_fail' | 
        'task_update' | 'llm_token' | 'progress_update' | 'data_update';
  phaseId?: string;
  line?: string;
  metadata?: {
    type?: 'info' | 'success' | 'warning' | 'error' | 'system';
    icon?: string;
    indent?: number;
    progress?: number; // 0-100
    data?: Record<string, any>;
  };
  taskRow?: any;
  token?: string;
  agentName?: string;
  durationMs?: number;
  error?: string;
}

export interface EnhancedPhaseState {
  id: string;
  number: number;
  name: string;
  status: PhaseCardStatus;
  lines: string[];
  structuredLines: EnhancedLine[];
  stream: string;
  streamAgent: string;
  collapsed: boolean;
  startMs?: number;
  durationMs?: number;
  tokenCount: number;
  dirty: boolean;
  aborted: boolean;
  progress: number; // 0-100
  data: Record<string, any>;
}

interface EnhancedLine {
  text: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'system' | 'kv' | 'divider' | 'section';
  icon?: string;
  indent: number;
  timestamp: number;
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

// ── Enhanced Phase Renderer ─────────────────────────────────────────────────
export class EnhancedPhaseRenderer {
  private phases: Map<string, EnhancedPhaseState> = new Map();
  private tasks: Map<string, any> = new Map();
  private linesRendered = 0;
  private pipelineStart = Date.now();
  private collapseTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private renderTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private spinFrame = 0;
  private tick = 0;
  private currentRequest = '';
  private tokenTimestamps: number[] = [];
  private selectedIndex = -1;
  
  constructor() {
    this.initPhases();
  }
  
  // ── Lifecycle ──────────────────────────────────────────────────────────────
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
    }, 80);
  }
  
  stop(): void {
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
  }
  
  reset(): void {
    this.stop();
    for (const t of this.collapseTimers.values()) clearTimeout(t);
    this.collapseTimers.clear();
    this.phases.clear();
    this.tasks.clear();
    this.linesRendered = 0;
    this.pipelineStart = Date.now();
    this.spinFrame = 0;
    this.tick = 0;
    this.dirty = false;
    this.currentRequest = '';
    this.tokenTimestamps = [];
    this.selectedIndex = -1;
    this.initPhases();
  }
  
  finalize(): void {
    this.stop();
    this.render();
    process.stdout.write('\n');
    this.linesRendered = 0;
    process.stdout.write('\x1B[?25h');
  }
  
  setRequest(text: string): void {
    this.currentRequest = text;
    this.dirty = true;
  }
  
  // ── Event Handling ─────────────────────────────────────────────────────────
  onEvent(event: EnhancedPhaseEvent): void {
    switch (event.type) {
      case 'phase_start': {
        const p = this.phases.get(event.phaseId!);
        if (p) {
          p.status = 'running';
          p.collapsed = false;
          p.startMs = Date.now();
          p.stream = '';
          p.dirty = true;
          p.progress = 0;
          p.structuredLines = [];
          
          const t = this.collapseTimers.get(event.phaseId!);
          if (t) clearTimeout(t);
        }
        break;
      }
      
      case 'phase_line': {
        const p = this.phases.get(event.phaseId!);
        if (p && event.line) {
          // Handle structured logging
          const enhancedLine: EnhancedLine = {
            text: event.line,
            type: event.metadata?.type || 'info',
            icon: event.metadata?.icon,
            indent: event.metadata?.indent || 0,
            timestamp: Date.now(),
          };
          
          p.structuredLines.push(enhancedLine);
          if (p.structuredLines.length > 20) {
            p.structuredLines = p.structuredLines.slice(-20);
          }
          
          // Also keep plain lines for backward compatibility
          p.lines.push(event.line);
          if (p.lines.length > 12) {
            p.lines = p.lines.slice(-12);
          }
          
          p.dirty = true;
        }
        break;
      }
      
      case 'llm_token': {
        const target = (event.phaseId ? this.phases.get(event.phaseId) : undefined) ?? this.getActivePhase();
        if (target) {
          target.tokenCount++;
          target.streamAgent = event.agentName ?? '';
          target.stream = this.appendToken(target.stream, event.token ?? '');
          target.dirty = true;
          
          const now = Date.now();
          this.tokenTimestamps.push(now);
          const cutoff = now - 5000; // 5-second window
          while (this.tokenTimestamps.length && this.tokenTimestamps[0] < cutoff) {
            this.tokenTimestamps.shift();
          }
        }
        break;
      }
      
      case 'progress_update': {
        const p = this.phases.get(event.phaseId!);
        if (p && event.metadata?.progress !== undefined) {
          p.progress = Math.max(0, Math.min(100, event.metadata.progress));
          p.dirty = true;
        }
        break;
      }
      
      case 'data_update': {
        const p = this.phases.get(event.phaseId!);
        if (p && event.metadata?.data) {
          Object.assign(p.data, event.metadata.data);
          p.dirty = true;
        }
        break;
      }
      
      case 'phase_done': {
        const p = this.phases.get(event.phaseId!);
        if (p) {
          p.status = 'passed';
          p.durationMs = event.durationMs ?? (p.startMs ? Date.now() - p.startMs : 0);
          p.progress = 100;
          p.stream = '';
          p.dirty = true;
          
          // Collapse completed phase after delay
          const id = event.phaseId!;
          const t = setTimeout(() => {
            const pp = this.phases.get(id);
            if (pp) {
              pp.collapsed = true;
              pp.dirty = true;
              this.dirty = true;
            }
          }, 2000);
          this.collapseTimers.set(id, t);
        }
        break;
      }
      
      case 'phase_fail': {
        const p = this.phases.get(event.phaseId!);
        if (p) {
          p.status = 'failed';
          p.collapsed = false;
          p.durationMs = event.durationMs ?? (p.startMs ? Date.now() - p.startMs : 0);
          p.stream = '';
          p.dirty = true;
        }
        break;
      }
      
      case 'task_update': {
        if (event.taskRow) {
          this.tasks.set(event.taskRow.id, event.taskRow);
        }
        break;
      }
    }
    
    this.dirty = true;
    if (!this.renderTimer) {
      this.render();
    }
  }
  
  // ── Rendering ──────────────────────────────────────────────────────────────
  render(): void {
    const width = getTerminalWidth();
    const lines: string[] = [''];
    
    // Request header
    if (this.currentRequest) {
      const req = this.currentRequest.length > width - 16
        ? this.currentRequest.slice(0, width - 19) + '…'
        : this.currentRequest;
      lines.push(`  ${c.primary('◆')} ${c.text(req)}`);
      lines.push('');
    }
    
    // Live status header
    const all = [...this.phases.values()];
    const total = PHASE_ORDER.length;
    const done = all.filter(p => p.status === 'passed').length;
    const failed = all.filter(p => p.status === 'failed').length;
    const running = all.filter(p => p.status === 'running');
    const elapsed = this.formatDuration(Date.now() - this.pipelineStart);
    
    const tps = this.tokenTimestamps.length > 1
      ? Math.round((this.tokenTimestamps.length / 5000) * 1000)
      : 0;
    const eta = this.getETA();
    
    const spin = c.primary(FRAMES[this.spinFrame]);
    const title = running.length
      ? shimmerText(`${running[0].name}…`, this.tick >> 1)
      : failed ? c.error('failed')
      : done === total ? c.success('complete')
      : c.dim('starting…');
    
    const meta = [
      c.dim(elapsed),
      tps > 0 ? c.dim(`${tps} tok/s`) : '',
      eta ? c.dim(`${eta} left`) : '',
    ].filter(Boolean).join(c.dim(' · '));
    
    lines.push(`  ${spin} ${title}  ${meta}`);
    
    // Progress mini-map
    const progressBar = createProgressBar(
      Math.round((done / total) * 100),
      '',
      { width: 30, showPercentage: true, color: 'accent' }
    );
    
    const counter = c.dim(`${done}/${total}`) + (failed ? c.error(` ${failed}✗`) : '');
    const escHint = c.dim('esc to interrupt');
    const progressLeft = `  ${progressBar}  ${counter}`;
    const gap = Math.max(2, width - stripAnsi(progressLeft).length - stripAnsi(escHint).length - 2);
    
    lines.push(progressLeft + ' '.repeat(gap) + escHint);
    lines.push('');
    
    // Phase list with enhanced display
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
          number: phase.number,
          name: phase.name,
          status: 'passed',
          durationMs: phase.durationMs,
        })));
        continue;
      }
      
      // Use enhanced phase display for running, failed, or expanded phases
      const display = createPhaseDisplay({
        number: phase.number,
        name: phase.name,
        status: phase.status,
        durationMs: phase.durationMs,
        progress: phase.progress,
        details: this.formatStructuredLines(phase.structuredLines, width - 8),
        collapsed: phase.collapsed && phase.status !== 'running',
        width: width - 4,
      });
      
      lines.push(sel(idx, `  ${display}`));
      
      // Show streaming output if active
      if (phase.stream && phase.status === 'running') {
        const streamOutput = createStreamingOutput({
          text: phase.stream,
          agent: phase.streamAgent,
          tokenCount: phase.tokenCount,
          elapsedMs: phase.startMs ? Date.now() - phase.startMs : undefined,
          showCursor: true,
          width: width - 8,
        });
        lines.push(`      ${streamOutput}`);
      }
    }
    
    // Task grid
    if (this.tasks.size > 0) {
      const activeTasks = [...this.tasks.values()].filter(t => t.status !== 'done');
      if (activeTasks.length > 0) {
        lines.push('');
        const taskGrid = createTaskGrid(activeTasks, width - 4);
        lines.push(`  ${taskGrid}`);
      }
    }
    
    // Keyboard hint
    if (this.renderTimer) {
      lines.push('');
      lines.push(`  ${c.dim('↑↓ phases · ↵ expand · a all · c collapse · esc to interrupt')}`);
    }
    
    lines.push('');
    
    // Atomic write
    const output = lines.join('\n');
    const newLineCount = (output.match(/\n/g) ?? []).length + 1;
    let buf = '';
    if (this.linesRendered > 0) {
      buf += `\x1B[${Math.min(this.linesRendered, newLineCount + 10)}A\x1B[0J`;
    }
    buf += output;
    process.stdout.write(buf);
    this.linesRendered = newLineCount;
  }
  
  // ── Helper Methods ─────────────────────────────────────────────────────────
  private initPhases(): void {
    this.phases.clear();
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const id = PHASE_ORDER[i];
      this.phases.set(id, {
        id,
        number: i + 1,
        name: PHASE_NAMES[id] || id,
        status: 'pending',
        lines: [],
        structuredLines: [],
        stream: '',
        streamAgent: '',
        collapsed: true,
        tokenCount: 0,
        dirty: false,
        aborted: false,
        progress: 0,
        data: {},
      });
    }
  }
  
  private hasRunning(): boolean {
    return [...this.phases.values()].some(p => p.status === 'running');
  }
  
  private getActivePhase(): EnhancedPhaseState | undefined {
    return [...this.phases.values()].find(p => p.status === 'running');
  }
  
  private getETA(): string {
    const all = [...this.phases.values()];
    const done = all.filter(p => p.status === 'passed').length;
    const total = PHASE_ORDER.length;
    
    if (done === 0 || done === total) return '';
    
    const elapsed = Date.now() - this.pipelineStart;
    const rate = done / elapsed; // phases per millisecond
    const remaining = total - done;
    const etaMs = remaining / rate;
    
    return this.formatDuration(etaMs);
  }
  
  private appendToken(current: string, token: string): string {
    const newText = current + token;
    const lines = newText.split('\n');
    if (lines.length > 4) {
      return lines.slice(-4).join('\n');
    }
    return newText;
  }
  
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  
  private formatStructuredLines(lines: EnhancedLine[], width: number): string[] {
    const formatted: string[] = [];
    
    for (const line of lines.slice(-8)) { // Show last 8 lines
      const indent = '  '.repeat(line.indent);
      const icon = line.icon ? `${line.icon} ` : '';
      let text = line.text;
      
      // Apply color based on type
      switch (line.type) {
        case 'success':
          text = c.success(text);
          break;
        case 'warning':
          text = c.warning(text);
          break;
        case 'error':
          text = c.error(text);
          break;
        case 'system':
          text = c.dim(text);
          break;
        case 'kv':
          text = c.text(text);
          break;
        case 'divider':
          text = c.dim('─'.repeat(Math.min(40, width - indent.length - 2)));
          break;
        case 'section':
          text = c.bold(text);
          break;
        default:
          text = c.muted(text);
      }
      
      // Truncate if needed
      const maxLength = width - indent.length - (icon ? 2 : 0);
      if (stripAnsi(text).length > maxLength) {
        text = truncate(text, maxLength);
      }
      
      formatted.push(`${indent}${icon}${text}`);
    }
    
    return formatted;
  }
  
  // ── Public API ────────────────────────────────────────────────────────────
  static create(): EnhancedPhaseRenderer {
    return new EnhancedPhaseRenderer();
  }
}