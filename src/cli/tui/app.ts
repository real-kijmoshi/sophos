// ── SOPHOS TUI — full-screen terminal app ─────────────────────────────────────
// A real TUI (alternate screen buffer), not an inline log:
//
//   ┌ header ──── session tabs · model · branch ─────────────────┐
//   │ transcript — scrollable, streams live LLM tokens            │
//   │ …                                                           │
//   ├─────────────────────────────────────────────────────────────┤
//   │ status — shimmer phase · elapsed · tok/s · phase dots       │
//   │ ❯ input — ALWAYS active; typing mid-run queues steering     │
//   │ footer — contextual key hints                               │
//   └─────────────────────────────────────────────────────────────┘
//
// Sessions: ctrl+t new · ctrl+w close · tab / ctrl+←→ cycle · alt+1-9 jump.
// Each session has its own transcript, chat history, and (possibly running)
// pipeline; tabs show ◐ while running and ✓/✗ when a background run finishes.
// Typing while a pipeline runs queues a steering note that is injected into
// the orchestrator so phases that haven't started yet honor it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { format } from 'node:util';
import pkg from '../../../package.json';
import { Screen }         from './screen.js';
import { Transcript }     from './transcript.js';
import { LineEditor }     from '../editor.js';
import { CommandPalette } from '../command-palette.js';
import { FRAMES }         from '../spinner-frames.js';
import {
  c, vLen, formatDuration, shimmerText, phaseDots, center,
  panelTop, panelRow, panelBottom, asciiLogo, gradientText, TOKENS,
  helpPanel, errorCard, shipItPanel, cancelCard,
  actionsBar, suggestionsBar, confirmPrompt, classifyError, goodbyeCard,
  type PhaseCardStatus,
} from '../ui.js';
import { parseIntent, generateSuggestions, type SuggestionContext } from '../intent-parser.js';
import { SessionManager }   from '../session.js';
import { CostTracker }      from '../cost-tracker.js';
import { ModelSelector }    from '../model-selector.js';
import { GitIntegration }   from '../git-integration.js';
import { PermissionSystem } from '../permissions.js';
import { findCommand, type CommandContext } from '../commands.js';
import { Orchestrator }     from '../../orchestrator.js';
import { loadConfig }       from '../../config/config.js';
import { ProjectStore }     from '../../config/project-store.js';
import { InteractiveDiffViewer } from '../diff-viewer.js';
import { FileBrowser, FilePicker } from '../file-browser.js';
import { savePipelineState, loadPipelineState, setProjectStore } from '../pipeline-state.js';
import { HistoryStore } from '../history-store.js';
import { FileIndex }    from '../file-index.js';
import { LLMAgent }         from '../../llm/agent.js';
import { InteractiveAgent } from '../../llm/interactive-agent.js';
import type { OrchestratorConfig } from '../../types.js';

const CTRL_C_WINDOW_MS = 2000;
const FRAME_MS         = 80;
const STREAM_TAIL      = 8;      // live stream rows shown under the running phase
const TPS_WINDOW_MS    = 5000;

const PHASE_ORDER = [
  'repository-analysis', 'planning-swarm',     'execution-planning',
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

interface PhaseView {
  id:          string;
  name:        string;
  status:      PhaseCardStatus;
  startMs?:    number;
  durationMs?: number;
}

interface TuiSession {
  id:         number;
  title:      string;
  transcript: Transcript;
  draft:      string;
  chat:       SessionManager;
  // pipeline
  running:       boolean;
  pipelineStart: number;
  lastRequest:   string;
  phases:        Map<string, PhaseView>;
  streamBuf:     string;
  streamAgent:   string;
  tokenCount:    number;
  tokenTimes:    number[];
  notes:         string[];
  abortCtrl:     AbortController | null;
  orch:          Orchestrator | null;
  // post-run
  lastSuccess:      boolean;
  lastDeliverables: any;
  /** Pipeline finished while another session was active — badge until visited. */
  unread: false | 'ok' | 'fail';
  // agent mode (fast tool loop, vs the 9-phase pipeline)
  mode:          'pipeline' | 'agent';
  agentActivity: string;
  agentTools:    number;
  /** Messages typed while the agent was busy — routed when it finishes. */
  queued: string[];
}

export interface TuiConfig {
  projectDir: string;
  model?:     string;
  verbose?:   boolean;
  dryRun?:    boolean;
}

export class TuiApp {
  private screen  = new Screen();
  private palette = new CommandPalette({ files: q => this.fileIndex.match(q) });
  private editor!: LineEditor;
  private fileIndex!:    FileIndex;
  private historyStore!: HistoryStore;
  private lastPipeline: ReturnType<typeof loadPipelineState> = null;

  private sessions:  TuiSession[] = [];
  private activeIdx = 0;
  private nextId    = 1;

  private costTracker:   CostTracker;
  private modelSelector: ModelSelector;
  private git:           GitIntegration;
  private permissions:   PermissionSystem;
  private projectStore:  ProjectStore;
  private diffViewer     = new InteractiveDiffViewer();

  private planMode     = false;
  private streamOutput = true;
  private compactAuto  = true;
  private history:     string[] = [];
  private recentIntents: string[] = [];
  private suggestionCtx: SuggestionContext = {};

  private gitBranch = '';
  private gitDirty  = false;

  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private dirty     = true;
  private spinFrame = 0;
  private tick      = 0;
  private quitting  = false;
  private lastViewH = 20;

  // Global output interception. Bun's console.log writes to the fd directly
  // (it does NOT go through process.stdout.write), so while the TUI owns the
  // terminal we intercept console methods AND stdout/stderr writes and route
  // everything into the transcript. Only the Screen keeps a real writer.
  private intercepting = false;
  private origOutWrite:  typeof process.stdout.write | null = null;
  private origErrWrite:  typeof process.stderr.write | null = null;
  private origConsole:   Record<string, (...args: any[]) => void> = {};
  private sinkSession:   TuiSession | null = null;
  private sinkPartial   = '';
  private sinkLastWrite = 0;

  private ctrlCArmed = false;
  private ctrlCTimer: ReturnType<typeof setTimeout> | null = null;

  private awaitingConfirm = false;
  private pendingConfirmAction: (() => Promise<void>) | null = null;
  private pendingConfirmCancel: (() => void) | null = null;

  private sessionStart  = Date.now();
  private pipelineCount = 0;
  private totalTokens   = 0;
  private commitCount   = 0;

  private exitHook = () => {
    try {
      this.removeSink();
      process.stdout.write('\x1B[?1049l\x1B[?25h');
      process.stdin.setRawMode?.(false);
    } catch { /* terminal already gone */ }
  };

  constructor(private cfg: TuiConfig) {
    this.costTracker   = new CostTracker();
    this.modelSelector = new ModelSelector(cfg.model || undefined);
    this.git           = new GitIntegration(cfg.projectDir);
    this.permissions   = new PermissionSystem();
    this.projectStore  = new ProjectStore(cfg.projectDir);
    this.projectStore.init();
    setProjectStore(this.projectStore);
    this.fileIndex     = new FileIndex(cfg.projectDir);
    this.historyStore  = new HistoryStore(cfg.projectDir);
    // Editor keeps a live reference to this array — persisted after each submit.
    this.history       = this.historyStore.load();
  }

  private get active(): TuiSession { return this.sessions[this.activeIdx]; }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    process.on('exit', this.exitHook);
    this.screen.enter();
    this.screen.onResize(() => { this.dirty = true; this.renderFrame(); });

    this.newSession();

    this.editor = new LineEditor({
      managed:   true,
      onDirty:   () => { this.dirty = true; this.renderFrame(); },
      prompt:    () => this.makePrompt(),
      onSubmit:  line => { this.handleSubmit(line).catch(() => {}); },
      intercept: (str, key) => this.interceptKey(str, key),
      onChange:  line => this.onInputChange(line),
      onCtrlC:   () => this.handleCtrlC(),
      onCtrlKey: name => this.handleCtrlKey(name),
      onEscape:  () => this.handleEscape(),
      onTab:     () => this.handleTab(),
      onEof:     () => this.quit(),
      history:   this.history,
      historySize: 200,
    });
    this.editor.start();
    this.installSink();

    this.frameTimer = setInterval(() => this.tickFrame(), FRAME_MS);
    this.renderFrame();
    this.backgroundInit().catch(() => {});
  }

  // ── Global output sink ──────────────────────────────────────────────────────
  // While the TUI owns the terminal, every stray write — console.* (which in
  // Bun goes straight to the fd), process.stdout/stderr.write from spinners,
  // servers, phases — is routed into a session transcript instead of painting
  // over the alternate screen. Only the Screen keeps the real writer.

  private installSink(): void {
    if (this.intercepting) return;
    this.intercepting = true;

    this.origOutWrite = process.stdout.write;
    this.origErrWrite = process.stderr.write;
    const sink = (chunk: any, ...rest: any[]): boolean => {
      this.sinkWrite(chunk);
      const cb = rest.find(a => typeof a === 'function');
      cb?.();
      return true;
    };
    (process.stdout as any).write = sink;
    (process.stderr as any).write = sink;

    for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      this.origConsole[name] = (console as any)[name];
      (console as any)[name] = (...args: any[]) => { this.sinkWrite(format(...args) + '\n'); };
    }
  }

  private removeSink(): void {
    if (!this.intercepting) return;
    this.intercepting = false;
    this.flushSink();
    if (this.origOutWrite) { (process.stdout as any).write = this.origOutWrite; this.origOutWrite = null; }
    if (this.origErrWrite) { (process.stderr as any).write = this.origErrWrite; this.origErrWrite = null; }
    for (const [name, fn] of Object.entries(this.origConsole)) (console as any)[name] = fn;
    this.origConsole = {};
  }

  /** Route one stray chunk into the owning session's transcript. */
  private sinkWrite(chunk: any): void {
    let str = typeof chunk === 'string' ? chunk : (chunk?.toString?.('utf-8') ?? '');
    if (!str) return;
    str = stripNonSgr(str);
    const s = this.sinkSession ?? this.active;
    if (!s) return;
    for (const ch of str) {
      if (ch === '\n')      { s.transcript.pushRaw(this.sinkPartial); this.sinkPartial = ''; }
      else if (ch === '\r') { this.sinkPartial = ''; }
      else                  { this.sinkPartial += ch; }
    }
    this.sinkLastWrite = Date.now();
    this.dirty = true;
  }

  /** Push a dangling partial line (no trailing newline yet) into the transcript. */
  private flushSink(): void {
    if (!this.sinkPartial.trim()) { this.sinkPartial = ''; return; }
    const s = this.sinkSession ?? this.active;
    s?.transcript.pushRaw(this.sinkPartial);
    this.sinkPartial = '';
    this.dirty = true;
  }

  /** Palette follows the input; an @-mention lazily builds the file index. */
  private onInputChange(line: string): void {
    this.palette.update(line);
    if (/@[^\s@]*$/.test(line)) {
      this.fileIndex.refresh().then(() => {
        if (this.editor.getLine() === line) {
          this.palette.update(line);
          this.dirty = true;
          this.renderFrame();
        }
      }).catch(() => {});
    }
  }

  private async backgroundInit(): Promise<void> {
    this.lastPipeline = loadPipelineState();
    const [gitInfo] = await Promise.all([
      this.git.getInfo().catch(() => null),
      this.modelSelector.discover().catch(() => {}),
    ]);

    if (gitInfo?.isRepo) {
      this.gitBranch = gitInfo.branch;
      this.gitDirty  = !gitInfo.isClean;
      this.suggestionCtx.branch = gitInfo.branch;
      this.suggestionCtx.dirty  = !gitInfo.isClean;
      this.suggestionCtx.recentFiles = [
        ...gitInfo.staged, ...gitInfo.modified, ...gitInfo.notAdded,
      ].slice(0, 20);
    }

    // The welcome screen (rendered while the transcript is empty) surfaces
    // model/git status itself — only the setup wizard needs an interjection.
    const online = this.modelSelector.isOllamaOnline();
    const model  = this.modelSelector.getCurrentModel();
    if (online && !model) {
      await this.suspendTui(() => this.modelSelector.runSetupWizard('local'));
    }
    this.dirty = true;
  }

  private quit(): void {
    if (this.quitting) return;
    this.quitting = true;
    if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null; }
    for (const s of this.sessions) s.abortCtrl?.abort();
    this.editor?.destroy();
    this.removeSink();
    this.screen.destroy();
    process.removeListener('exit', this.exitHook);
    process.stdin.setRawMode?.(false);
    process.stdout.write(goodbyeCard({
      sessionMs: Date.now() - this.sessionStart,
      pipelines: this.pipelineCount,
      tokens:    this.totalTokens,
      commits:   this.commitCount,
      model:     this.modelSelector.getCurrentModel() || undefined,
    }));
    process.stdout.write('\n', () => process.exit(0));
  }

  // ── Sessions ────────────────────────────────────────────────────────────────

  private newSession(): void {
    const s: TuiSession = {
      id:         this.nextId++,
      title:      '',
      transcript: new Transcript(),
      draft:      '',
      chat:       new SessionManager(this.cfg.model || 'auto', this.cfg.projectDir),
      running:       false,
      pipelineStart: 0,
      lastRequest:   '',
      phases:        new Map(),
      streamBuf:     '',
      streamAgent:   '',
      tokenCount:    0,
      tokenTimes:    [],
      notes:         [],
      abortCtrl:     null,
      orch:          null,
      lastSuccess:      false,
      lastDeliverables: null,
      unread:           false,
      mode:          'pipeline',
      agentActivity: '',
      agentTools:    0,
      queued:        [],
    };
    this.initPhases(s);
    this.sessions.push(s);
    this.switchTo(this.sessions.length - 1);
  }

  private switchTo(idx: number): void {
    if (idx < 0 || idx >= this.sessions.length) return;
    if (this.editor && this.sessions[this.activeIdx]) {
      this.sessions[this.activeIdx].draft = this.editor.getLine();
    }
    this.activeIdx = idx;
    this.active.unread = false;   // visiting the tab clears its finished badge
    if (this.editor) this.editor.setLine(this.active.draft || '');
    this.dirty = true;
  }

  /** Ctrl+W (empty input): close the active session; confirm if it's running. */
  private closeSession(): void {
    const s = this.active;
    if (this.sessions.length === 1 && s.transcript.isEmpty() && !s.running) return;
    if (s.running) {
      this.awaitingConfirm = true;
      this.pendingConfirmAction = async () => { this.reallyCloseSession(s); };
      s.transcript.push(confirmPrompt('This session has a running pipeline — closing aborts it.'));
      this.dirty = true;
      return;
    }
    this.reallyCloseSession(s);
  }

  private reallyCloseSession(s: TuiSession): void {
    const idx = this.sessions.indexOf(s);
    if (idx < 0) return;
    s.abortCtrl?.abort();
    this.sessions.splice(idx, 1);
    this.activeIdx = -1;   // closed session's draft dies with it
    if (this.sessions.length === 0) { this.newSession(); return; }
    this.switchTo(Math.min(idx, this.sessions.length - 1));
  }

  private cycleSession(delta: number): void {
    if (this.sessions.length < 2) return;
    this.switchTo((this.activeIdx + delta + this.sessions.length) % this.sessions.length);
  }

  private initPhases(s: TuiSession): void {
    s.phases.clear();
    for (const id of PHASE_ORDER) {
      s.phases.set(id, { id, name: PHASE_NAMES[id] ?? id, status: 'pending' });
    }
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  private tickFrame(): void {
    this.spinFrame = (this.spinFrame + 1) % FRAMES.length;
    this.tick++;
    // Stray output without a trailing newline (prompts, spinner tails) becomes
    // visible once the writer goes quiet.
    if (this.sinkPartial && Date.now() - this.sinkLastWrite > 300) this.flushSink();
    if (this.dirty || this.sessions.some(s => s.running)) this.renderFrame();
  }

  private renderFrame(): void {
    if (this.quitting || !this.screen.isActive()) return;
    const { rows, cursor } = this.compose();
    this.screen.render(rows, cursor);
    this.dirty = false;
  }

  private compose(): { rows: string[]; cursor: { row: number; col: number } | null } {
    const w = this.screen.cols;
    const h = this.screen.rows;
    const s = this.active;
    const viewH = Math.max(3, h - 6);
    this.lastViewH = viewH;

    const rows: string[] = [];
    rows.push(this.headerRow(w));

    // Transcript viewport (+ live stream tail while following the bottom),
    // or the centered welcome screen while the session is still empty.
    let body: string[];
    if (s.transcript.isEmpty() && !s.running) {
      body = this.welcomeLines(w, viewH);
    } else {
      const view = s.transcript.view(w, viewH, this.liveLines(s));
      body = view.rows;
      if (view.below > 0) {
        body = [...body];
        const above = view.above > 0 ? ` · ↑ ${view.above} above` : '';
        body[body.length - 1] = `  ${c.dim(`↓ ${view.below} rows below${above} — esc to follow live output`)}`;
      }
    }
    if (this.palette.visible) {
      const pal = this.palette.renderLines(w);
      body = [...body];
      const start = Math.max(0, viewH - pal.length);
      for (let i = 0; i < pal.length && start + i < viewH; i++) body[start + i] = pal[i];
    }
    rows.push(...body);

    rows.push(this.statusRow(w));

    const input = this.inputBox(w);
    rows.push(...input.rows);
    rows.push(this.footerRow(w));

    const cursor = this.editor?.isActive()
      ? { row: h - 3, col: input.col }
      : null;
    return { rows, cursor };
  }

  // ── Frame pieces ────────────────────────────────────────────────────────────

  private headerRow(w: number): string {
    const n = this.sessions.length;
    const maxTabWidth = 40;
    const labelOf = (sess: TuiSession, i: number) => {
      const badge = sess.running        ? c.warning('◐') + ' '
                  : sess.unread === 'ok'   ? c.success('✓') + ' '
                  : sess.unread === 'fail' ? c.error('✗')   + ' '
                  : '';
      return `${i + 1} ${badge}${sess.title || 'new'}`;
    };

    let tabsStr: string;
    if (n <= 4) {
      const tabs = this.sessions.map((sess, i) => {
        const label = ` ${labelOf(sess, i)} `;
        return i === this.activeIdx ? c.accent.bold(label) : c.dim(label);
      });
      tabsStr = c.dim('│') + tabs.join(c.dim('│'));
    } else {
      const cur = this.activeIdx;
      const parts: string[] = [];
      if (cur > 0) parts.push(c.dim(`‹${cur}`));
      const curLabel = ` ${labelOf(this.active, cur)} `;
      parts.push(c.accent.bold(curLabel));
      if (cur < n - 1) parts.push(c.dim(`${cur + 2}›`));
      if (n > cur + 2) parts.push(c.dim(`+${n - cur - 1}`));
      tabsStr = c.dim('│') + parts.join(c.dim('│'));
    }

    const left = ` ${c.accent('✦')} ${c.text.bold('sophos')}${tabsStr}`;

    const right = [
      c.dim(shortenPath(this.cfg.projectDir)),
      this.gitBranch ? c.dim(`⎇ ${this.gitBranch}${this.gitDirty ? '*' : ''}`) : '',
      this.totalTokens > 0 ? c.dim(`${kfmt(this.totalTokens)} tok`) : '',
    ].filter(Boolean).join(c.dim(' · ')) + ' ';

    const gap = Math.max(1, w - vLen(left) - vLen(right));
    return left + ' '.repeat(gap) + right;
  }

  // Centered empty-session welcome (opencode-style): logo, version, context,
  // and the two or three keys you need to get going. Replaced by the transcript
  // the moment the first message lands.
  private welcomeLines(w: number, viewH: number): string[] {
    const lines: string[] = [];
    const showLogo = viewH >= 14;

    if (showLogo) {
      for (const l of asciiLogo({ small: w < 72 }).split('\n')) lines.push(center(l, w));
      lines.push('');
    } else {
      lines.push(center(gradientText('◆ sophos', TOKENS.colors.accent, TOKENS.colors.purple), w));
    }
    lines.push(center(c.dim('v3.2 · multi-agent orchestrator'), w));
    lines.push('');

    const model  = this.modelSelector.getCurrentModel();
    const online = this.modelSelector.isOllamaOnline();
    const modelStr = !online
      ? `${c.error('●')} ${c.error('ollama offline')} ${c.dim('— start it, then /models')}`
      : model
        ? `${c.success('●')} ${c.text(model)}`
        : `${c.warning('●')} ${c.warning('no model')} ${c.dim('— /models to choose')}`;
    const ctx = [
      modelStr,
      this.gitBranch
        ? (this.gitDirty ? c.warning(`⎇ ${this.gitBranch}*`) : c.dim(`⎇ ${this.gitBranch}`))
        : '',
    ].filter(Boolean).join(c.dim('   '));
    lines.push(center(ctx, w));
    lines.push('');
    lines.push(center(`${c.muted('describe what you want to build, then press')} ${c.text('↵')}`, w));
    lines.push(center(c.dim('/ commands · @ mention files · ctrl+t new session · ctrl+w close · ctrl+c ×2 quit'), w));

    if (this.lastPipeline?.request) {
      lines.push('');
      const req = this.lastPipeline.request.replace(/\s+/g, ' ');
      const short = req.length > 44 ? req.slice(0, 43) + '…' : req;
      lines.push(center(`${c.dim('↺ last:')} ${c.muted(`“${short}”`)} ${c.dim('· /resume to run again')}`, w));
    }

    const top = Math.max(0, Math.floor((viewH - lines.length) / 2));
    const out = [...Array(top).fill(''), ...lines];
    while (out.length < viewH) out.push('');
    return out.slice(0, viewH);
  }

  private liveLines(s: TuiSession): string[] {
    if (!s.running) return [];
    const lines: string[] = [];

    if (this.streamOutput && s.streamBuf) {
      const width = Math.max(20, this.screen.cols - 8);
      const tail: string[] = [];
      for (const raw of s.streamBuf.split('\n')) {
        if (raw.length <= width) { tail.push(raw); continue; }
        for (let i = 0; i < raw.length; i += width) tail.push(raw.slice(i, i + width));
      }
      for (const t of tail.slice(-STREAM_TAIL)) {
        lines.push(`  ${c.dim('│')} ${c.muted(t)}`);
      }
    }
    if (s.notes.length) {
      lines.push(`  ${c.warning('▷')} ${c.dim(`${s.notes.length} steering note${s.notes.length > 1 ? 's' : ''} queued for upcoming phases`)}`);
    }
    return lines;
  }

  // Claude Code-style activity line: spinner + shimmering phase name + a
  // parenthesized live meta trail, phase mini-map right-aligned.
  private statusRow(w: number): string {
    const s = this.active;
    if (s.running) {
      const spin = c.accent(FRAMES[this.spinFrame]);
      let title: string;
      let right: string;
      if (s.mode === 'agent') {
        const act = s.agentActivity ? `agent · ${truncTag(s.agentActivity, 40)}` : 'agent thinking…';
        title = shimmerText(act, this.tick >> 1);
        right = s.agentTools > 0 ? `${c.dim(`⚒ ${s.agentTools} tool${s.agentTools > 1 ? 's' : ''}`)} ` : '';
      } else {
        const phase = [...s.phases.values()].find(p => p.status === 'running');
        title = phase ? shimmerText(`${phase.name}…`, this.tick >> 1) : c.dim('starting…');
        const done = [...s.phases.values()].filter(p => p.status === 'passed').length;
        right = `${phaseDots([...s.phases.values()].map(p => p.status))} ${c.dim(`${done}/9`)} `;
      }
      const tps   = s.tokenTimes.length > 1
        ? `${Math.round((s.tokenTimes.length / TPS_WINDOW_MS) * 1000)} tok/s` : '';
      const meta  = [
        'esc to interrupt',
        formatDuration(Date.now() - s.pipelineStart),
        s.tokenCount > 0 ? `${kfmt(s.tokenCount)} tok` : '',
        tps,
        s.mode === 'agent' ? '' : s.streamAgent,
      ].filter(Boolean).join(' · ');
      const left  = `  ${spin} ${title} ${c.dim(`(${meta})`)}`;
      const gap   = Math.max(1, w - vLen(left) - vLen(right));
      return left + ' '.repeat(gap) + right;
    }
    if (s.lastSuccess) {
      return `  ${c.success('✓ complete')}${c.dim('  —  ')}${c.text('s')} ${c.dim('ship')}${c.dim(' · ')}${c.text('d')} ${c.dim('diff')}${c.dim(' · ')}${c.text('r')} ${c.dim('review')}${c.dim(' · ')}${c.text('a')} ${c.dim('dismiss')}`;
    }
    if (this.planMode) {
      return `  ${c.warning('⏸ plan mode')} ${c.dim('— analysis only, no file writes · /plan off to disable')}`;
    }
    return '';
  }

  // Rounded bordered input box (Claude Code / opencode style). Middle row hosts
  // the editor; bottom border carries the mode + model tag.
  private inputBox(w: number): { rows: string[]; col: number } {
    const bw     = Math.max(20, w - 2);
    const prompt = this.makePrompt();
    const pw     = vLen(prompt);
    const avail  = Math.max(8, bw - 5 - pw);
    const v      = this.editor ? this.editor.visibleSlice(avail)
                               : { text: '', col: 0, leftMore: false, rightMore: false };

    const empty = v.text.length === 0 && !v.leftMore;
    const inner = empty
      ? prompt + c.dim(this.placeholder().slice(0, avail))
      : prompt + (v.leftMore ? c.dim('…') : '') + v.text + (v.rightMore ? c.dim('…') : '');

    const model  = this.modelSelector.getCurrentModel();
    const online = this.modelSelector.isOllamaOnline();
    const dot    = online ? c.success('●') : c.error('●');
    const modelTag = `${dot} ${c.dim(model ? truncTag(model, 28) : 'no model')}`;
    const tag = [
      this.active?.running ? c.warning(this.active.mode === 'agent' ? '▷ agent' : '▷ steering') : '',
      this.planMode        ? c.warning('plan')       : '',
      modelTag,
    ].filter(Boolean).join(c.dim(' · '));

    const rows = [
      ' ' + panelTop(bw),
      ' ' + panelRow(inner, bw),
      ' ' + panelBottom(bw, tag),
    ];
    return { rows, col: 3 + pw + (v.leftMore ? 1 : 0) + v.col };
  }

  private placeholder(): string {
    if (this.awaitingConfirm)  return 'y to confirm — anything else cancels';
    if (this.active?.running) {
      return this.active.mode === 'agent'
        ? 'agent working — ↵ queues a follow-up · esc interrupts'
        : 'type to steer the running pipeline — ↵ queues a note';
    }
    if (this.planMode)         return 'plan mode — describe what to analyze';
    return 'ask or build anything · "@" files · "/" commands';
  }

  private footerRow(w: number): string {
    let left: string;
    if (this.palette.visible)       left = `  ${c.dim('↑↓ select · tab complete · ↵ run · esc dismiss')}`;
    else if (this.ctrlCArmed)       left = `  ${c.warning('ctrl+c again to quit')}`;
    else if (this.awaitingConfirm)  left = `  ${c.warning('y to confirm — anything else cancels')}`;
    else if (this.active?.running)  left = `  ${c.dim(`↵ ${this.active.mode === 'agent' ? 'queue follow-up' : 'steer'} · esc interrupt · pgup/pgdn scroll · ctrl+t new session`)}`;
    else {
      const multi = this.sessions.length > 1 ? 'tab switch · ctrl+w close · ' : '';
      left = `  ${c.dim(`/ commands · @ files · ↑ history · ${multi}ctrl+t new session · pgup scroll · ctrl+c ×2 quit`)}`;
    }
    const pct   = this.active ? this.active.chat.getContextPct() : 0;
    const right = pct > 0
      ? (pct >= 80 ? c.warning(`ctx ${pct}% — /compact`) : c.dim(`ctx ${pct}%`)) + ' '
      : '';
    if (!right) return left;
    const gap = Math.max(1, w - vLen(left) - vLen(right));
    return left + ' '.repeat(gap) + right;
  }

  private makePrompt(): string {
    if (this.awaitingConfirm) return c.warning('❯ ');
    if (this.active?.running) return c.warning('▷ ');
    if (this.planMode)        return c.warning('❯ ');
    return c.accent('❯ ');
  }

  // ── Key routing ─────────────────────────────────────────────────────────────

  private interceptKey(
    str: string | undefined,
    key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean },
  ): boolean {
    if (this.ctrlCArmed && !(key.ctrl && key.name === 'c')) this.disarmCtrlC();

    // Transcript scrolling
    const w = this.screen.cols, vh = this.lastViewH;
    if (key.name === 'pageup')   { this.active.transcript.scrollBy(vh - 2, w, vh);   this.dirty = true; return true; }
    if (key.name === 'pagedown') { this.active.transcript.scrollBy(-(vh - 2), w, vh); this.dirty = true; return true; }
    if (key.shift && key.name === 'up')   { this.active.transcript.scrollBy(1, w, vh);  this.dirty = true; return true; }
    if (key.shift && key.name === 'down') { this.active.transcript.scrollBy(-1, w, vh); this.dirty = true; return true; }

    // Session switching
    if (key.ctrl && (key.name === 'left' || key.name === 'right')) {
      if (this.editor.getLine().length === 0) {
        this.cycleSession(key.name === 'right' ? 1 : -1);
        return true;
      }
      return false; // word jump when editing text
    }
    if (key.meta && key.name && /^[1-9]$/.test(key.name)) {
      this.switchTo(Number(key.name) - 1);
      return true;
    }

    // Palette navigation
    if (!this.palette.visible) return false;
    switch (key.name) {
      case 'up':   this.palette.nav(-1); return true;
      case 'down': this.palette.nav(1);  return true;
      case 'tab': {
        const item = this.palette.current();
        if (item) {
          const text = item.insert + (item.hasArgs ? ' ' : '');
          this.editor.setLine(text);
          this.palette.update(text);
        }
        return true;
      }
      case 'return':
      case 'enter': {
        const item = this.palette.current();
        if (!item) return true;
        if (item.kind === 'file') {
          // Completing a mention shouldn't submit — keep composing the request.
          const text = item.insert + ' ';
          this.editor.setLine(text);
          this.palette.update(text);
        } else {
          this.palette.hide();
          this.editor.submit(item.insert);
        }
        return true;
      }
      case 'escape':
        this.palette.dismiss(this.editor.getLine());
        return true;
    }
    return false;
  }

  private handleCtrlC(): void {
    if (this.editor.getLine().length > 0) return; // editor just cleared the line
    if (this.ctrlCArmed) { this.quit(); return; }
    this.ctrlCArmed = true;
    this.ctrlCTimer = setTimeout(() => this.disarmCtrlC(), CTRL_C_WINDOW_MS);
    this.dirty = true;
  }

  private disarmCtrlC(): void {
    this.ctrlCArmed = false;
    if (this.ctrlCTimer) { clearTimeout(this.ctrlCTimer); this.ctrlCTimer = null; }
    this.dirty = true;
  }

  private handleCtrlKey(name: string): boolean {
    switch (name) {
      case 't': this.newSession(); return true;
      case 'w': this.closeSession(); return true;
      case 'l': this.active.transcript.clear(); this.dirty = true; return true;
      case 'n':
        this.runCaptured(this.active, async () => {
          const { tray } = await import('../notification-tray.js');
          tray.showFull();
        }).catch(() => {});
        return true;
      case 'd':
        this.showDiff(this.active).catch(() => {});
        return true;
    }
    return false;
  }

  private handleEscape(): boolean {
    const s = this.active;
    if (s.running) {
      this.awaitingConfirm = true;
      this.pendingConfirmAction = () => { s.abortCtrl?.abort(); return Promise.resolve(); };
      this.dirty = true;
      return true;
    }
    if (this.editor.getLine().length > 0) return false; // editor clears the line
    if (s.transcript.scrollOffset > 0) { s.transcript.toBottom(); this.dirty = true; return true; }
    return false;
  }

  private handleTab(): void {
    if (!this.palette.visible && this.editor.getLine().length === 0 && this.sessions.length > 1) {
      this.cycleSession(1);
    }
  }

  // ── Submission + routing ────────────────────────────────────────────────────

  private async handleSubmit(raw: string): Promise<void> {
    const input = raw.trim();
    this.palette.hide();
    if (!input) { this.editor.resume(); return; }

    const s = this.active;
    s.transcript.pushRaw('');
    s.transcript.pushRaw(`  ${c.dim('❯')} ${c.text(input)}`);
    s.transcript.toBottom();
    this.dirty = true;
    // Editor already appended the line to this.history — persist it.
    this.historyStore.save(this.history);

    // Input stays live — this is what makes mid-run steering possible.
    this.editor.resume();

    await this.route(s, input);
    this.refreshGit().catch(() => {});
    this.dirty = true;
  }

  private async route(s: TuiSession, input: string): Promise<void> {
    // Pending y/N confirmation
    if (this.awaitingConfirm) {
      this.awaitingConfirm = false;
      const action = this.pendingConfirmAction;
      const cancel = this.pendingConfirmCancel;
      this.pendingConfirmAction = null;
      this.pendingConfirmCancel = null;
      if (/^(y|yes)$/i.test(input)) await action?.();
      else { cancel?.(); s.transcript.pushRaw(`  ${c.muted('Cancelled.')}`); }
      return;
    }

    // While this session works: slash commands run, text steers the pipeline
    // or queues a follow-up for the agent.
    if (s.running) {
      if (input.startsWith('/')) { await this.runCmd(s, input); return; }
      if (s.mode === 'agent') {
        s.queued.push(input);
        s.transcript.pushRaw(`  ${c.warning('▷')} ${c.dim('queued — runs when the agent finishes')}`);
        return;
      }
      s.notes.push(input);
      s.orch?.addSteering(input);
      s.chat.addMessage('user', `[steering] ${input}`);
      s.transcript.pushRaw(`  ${c.warning('▷')} ${c.dim('steering note queued — phases that haven’t started will honor it')}`);
      return;
    }

    // Post-pipeline shortcuts
    if (s.lastSuccess) {
      if (/^(s|ship(\s+it)?)$/i.test(input)) { await this.doShipIt(s); return; }
      if (/^(d|diff)$/i.test(input))         { await this.showDiff(s); return; }
      if (/^(r|review)$/i.test(input))       { await this.runCmd(s, '/review'); return; }
      if (/^(a|abort)$/i.test(input))        { s.lastSuccess = false; s.transcript.pushRaw(`  ${c.muted('Dismissed.')}`); return; }
    }

    // File browser shortcuts
    if (/^(f|files|browse)$/i.test(input)) { await this.openFileBrowser(s); return; }
    const pickMatch = input.match(/^pick\s*(.*)$/i);
    if (pickMatch) { await this.pickFile(s, pickMatch[1]?.trim()); return; }

    const intent = parseIntent(input);
    switch (intent.type) {
      case 'exit':    this.quit(); return;
      case 'help':    s.transcript.push(helpPanel(pkg.version)); return;
      case 'command': {
        const cmdName = input.replace(/^\//, '').split(/\s+/)[0];
        const rest    = input.replace(/^\/\S+\s*/, '').trim();
        if (cmdName === 'resume' || cmdName === 'r') { this.resumePrefill(s); return; }
        if (cmdName === 'agent') {
          if (!rest) { s.transcript.pushRaw(`  ${c.dim('usage: /agent <question or small task> — fast tool loop, no pipeline')}`); return; }
          await this.doAgent(s, rest);
          return;
        }
        if (cmdName === 'pipeline' || cmdName === 'pipe') {
          if (!rest) { s.transcript.pushRaw(`  ${c.dim('usage: /pipeline <request> — force the full 9-phase pipeline')}`); return; }
          await this.doPipeline(s, rest, this.planMode);
          return;
        }
        await this.runCmd(s, '/' + input.replace(/^\//, ''));
        return;
      }
      case 'rollback':
        this.awaitingConfirm = true;
        this.pendingConfirmAction = () => this.doRollback(s);
        s.transcript.push(confirmPrompt('This will stash your current changes.'));
        return;
      case 'git':     await this.runCmd(s, '/git ' + (intent.gitOp || 'status')); return;
      case 'view':    await this.runCmd(s, '/inspect ' + (intent.viewTarget || input)); return;
      case 'explain': await this.doAgent(s, intent.explainTarget || input); return;
      case 'model':
        if (intent.modelOverride) {
          this.modelSelector.setCurrentModel(intent.modelOverride.model);
          s.transcript.pushRaw(`  ${c.success('✓')} Model → ${c.accent(intent.modelOverride.model)}`);
        }
        return;
      default: {
        const req  = intent.pipelineRequest || input;
        const plan = intent.planOnly || this.planMode;
        // Conversational / ambiguous input goes to the fast agent loop —
        // explicit build verbs (high confidence) get the full pipeline.
        if (intent.confidence < 0.7 && !plan) { await this.doAgent(s, req); return; }
        this.recentIntents.push(req);
        const sugg = generateSuggestions(req, this.recentIntents, this.suggestionCtx);
        if (sugg.length && !plan) s.transcript.push(suggestionsBar(sugg));
        await this.doPipeline(s, req, plan);
      }
    }
  }

  // ── Pipeline ────────────────────────────────────────────────────────────────

  private async doPipeline(s: TuiSession, request: string, planOnly = false): Promise<void> {
    if (!this.modelSelector.isOllamaOnline()) {
      s.transcript.push(errorCard({ title: 'Ollama not running', message: 'connect ECONNREFUSED 127.0.0.1:11434' }));
      return;
    }
    if (!this.modelSelector.getCurrentModel()) {
      await this.suspendTui(() => this.modelSelector.runSetupWizard('local'));
      if (!this.modelSelector.getCurrentModel()) return;
    }

    if (!s.title) { s.title = titleFor(request); this.dirty = true; }
    s.running        = true;
    s.mode           = 'pipeline';
    s.pipelineStart  = Date.now();
    s.lastRequest    = request;
    s.lastSuccess    = false;
    s.lastDeliverables = null;
    s.streamBuf      = '';
    s.streamAgent    = '';
    s.tokenCount     = 0;
    s.tokenTimes     = [];
    s.notes          = [];
    this.initPhases(s);
    s.abortCtrl = new AbortController();
    this.pipelineCount++;

    savePipelineState({
      request, targetDir: this.cfg.projectDir, planOnly,
      model: this.modelSelector.getCurrentModel() ?? undefined,
      startedAt: s.pipelineStart, phases: [],
    });

    if (this.compactAuto && s.chat.isNearLimit()) {
      const r = await s.chat.compact();
      s.transcript.pushRaw(`  ${c.dim(`context compacted — saved ~${r.tokensSaved} tokens`)}`);
    }
    s.chat.addMessage('user', request);
    if (planOnly) s.transcript.pushRaw(`  ${c.warning('plan mode — no file writes')}`);

    try {
      const config = loadConfig();
      const orchConfig: OrchestratorConfig = {
        target_dir:            this.cfg.projectDir,
        user_request:          request,
        max_review_iterations: 3,
        max_repair_attempts:   2,
        verbose:               this.cfg.verbose || false,
        dry_run:               this.cfg.dryRun  || planOnly,
        model_small:           this.modelSelector.getSmallModel()    || undefined,
        model_medium:          this.modelSelector.getCurrentModel()  || undefined,
        model_large:           this.modelSelector.getLargeModel()    || undefined,
        model_coder:           this.modelSelector.getCoderModel()    || undefined,
        model_planner:         this.modelSelector.getPlannerModel()  || undefined,
        model_executor:        this.modelSelector.getExecutorModel() || undefined,
        model_chat:            this.modelSelector.getChatModel()     || undefined,
      };

      const orch = new Orchestrator(orchConfig, config);
      s.orch = orch;

      orch.on('phase:start', e => {
        const p = s.phases.get(e.phaseId);
        if (p) { p.status = 'running'; p.startMs = Date.now(); }
        s.streamBuf = '';
        s.transcript.pushRaw('');
        s.transcript.pushRaw(`  ${c.accent('●')} ${c.text.bold(e.phaseName)}`);
        this.dirty = true;
      });
      orch.on('phase:line', e => {
        s.transcript.pushRaw(`    ${c.dim('⎿')}  ${c.muted(e.line)}`);
        this.dirty = true;
      });
      orch.on('phase:done', e => {
        const p = s.phases.get(e.phaseId);
        if (p) { p.status = 'passed'; p.durationMs = e.durationMs; }
        s.streamBuf = '';
        s.transcript.pushRaw(`    ${c.dim('⎿')}  ${c.success('✓')} ${c.dim(`done in ${formatDuration(e.durationMs)}`)}`);
        this.dirty = true;
      });
      orch.on('phase:fail', e => {
        const p = s.phases.get(e.phaseId);
        if (p) { p.status = 'failed'; p.durationMs = e.durationMs; }
        s.streamBuf = '';
        s.transcript.pushRaw(`    ${c.dim('⎿')}  ${c.error('✗')} ${c.error(e.error || 'failed')}`);
        this.dirty = true;
      });
      orch.on('llm:token', (e: { chunk: string; agentName: string }) => {
        s.tokenCount++;
        const now = Date.now();
        s.tokenTimes.push(now);
        while (s.tokenTimes.length && s.tokenTimes[0] < now - TPS_WINDOW_MS) s.tokenTimes.shift();
        s.streamAgent = e.agentName ?? '';
        s.streamBuf   = (s.streamBuf + e.chunk).slice(-4000);
        this.dirty = true;
      });

      const result = await orch.execute(s.abortCtrl.signal);

      if (result.deliverables) {
        s.chat.addMessage('assistant', result.deliverables.executive_summary);
        const llm = result.deliverables.llm_stats;
        if (llm) {
          this.totalTokens += llm.total_tokens;
          this.costTracker.track(this.modelSelector.getCurrentModel(), llm.total_tokens, 0, request);
        }
        s.lastDeliverables = result.deliverables;
        s.lastSuccess      = result.success;

        if (result.success) {
          const d = result.deliverables;
          const vulns = d.security_report?.length ?? 0;
          const tests = d.test_results ? d.test_results.passed + d.test_results.failed : 0;
          const allDiffs = d.files_modified.map((f: any) => f.diff ?? '').join('\n');
          const diffStats = {
            added:   (allDiffs.match(/^\+(?!\+\+)/mg) ?? []).length,
            removed: (allDiffs.match(/^-(?!--)/mg)    ?? []).length,
            files:   d.files_modified.length + d.files_created.length,
          };
          const done = [...s.phases.values()].filter(p => p.status === 'passed').length;
          s.transcript.push(shipItPanel({
            phases: done, tests, vulns, diffStats,
            files:     d.files_created.length + d.files_modified.length,
            duration:  formatDuration(Date.now() - s.pipelineStart),
            commitMsg: `feat: ${request.slice(0, 60)}`,
          }));
          s.transcript.push(actionsBar({ canShip: true, canDiff: true, hasFiles: diffStats.files > 0 }));
        } else {
          s.transcript.push(errorCard({ title: 'Pipeline finished with errors', message: 'One or more phases failed.' }));
        }
      } else {
        s.transcript.push(errorCard({ title: 'Pipeline failed', message: 'No deliverables returned.' }));
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        const activePhase = [...s.phases.values()].find(p => p.status === 'running');
        if (activePhase) activePhase.status = 'failed';
        const done = [...s.phases.values()].filter(p => p.status === 'passed').length;
        s.transcript.push(cancelCard({
          request:      s.lastRequest,
          phasesDone:   done,
          phasesTotal:  PHASE_ORDER.length,
          activePhase:  activePhase?.name ?? 'pipeline',
          elapsed:      formatDuration(Date.now() - s.pipelineStart),
          filesChanged: 0,
        }));
      } else {
        s.transcript.push(errorCard({
          title: 'Error', message: err.message,
          hints: classifyError(err.message),
          raw:   err.stack?.split('\n').slice(0, 4).join('\n'),
        }));
      }
    } finally {
      s.running   = false;
      s.orch      = null;
      s.abortCtrl = null;
      s.streamBuf = '';
      if (s !== this.active) s.unread = s.lastSuccess ? 'ok' : 'fail';
      savePipelineState({
        request, targetDir: this.cfg.projectDir, planOnly,
        model:       this.modelSelector.getCurrentModel() ?? undefined,
        startedAt:   s.pipelineStart,
        completedAt: Date.now(),
        success:     s.lastSuccess,
        phases:      [],
      });
      this.lastPipeline = loadPipelineState();   // keep the welcome-screen hint fresh
      this.dirty = true;
    }
  }

  // ── Agent mode — fast tool loop for questions, chat, and small edits ────────

  private async doAgent(s: TuiSession, request: string): Promise<void> {
    if (!this.modelSelector.isOllamaOnline()) {
      s.transcript.push(errorCard({ title: 'Ollama not running', message: 'connect ECONNREFUSED 127.0.0.1:11434' }));
      return;
    }
    if (!this.modelSelector.getCurrentModel()) {
      await this.suspendTui(() => this.modelSelector.runSetupWizard('local'));
      if (!this.modelSelector.getCurrentModel()) return;
    }

    if (!s.title) { s.title = titleFor(request); this.dirty = true; }
    s.running       = true;
    s.mode          = 'agent';
    s.pipelineStart = Date.now();
    s.lastRequest   = request;
    s.streamBuf     = '';
    s.streamAgent   = '';
    s.tokenCount    = 0;
    s.tokenTimes    = [];
    s.agentTools    = 0;
    s.agentActivity = '';
    s.abortCtrl     = new AbortController();

    const model = this.modelSelector.getChatModel() || this.modelSelector.getCurrentModel()!;
    s.chat.addMessage('user', request);
    let ok = false;

    try {
      const llm = new LLMAgent(loadConfig());
      llm.setAbortSignal(s.abortCtrl.signal);
      llm.onToken(chunk => {
        s.tokenCount++;
        const now = Date.now();
        s.tokenTimes.push(now);
        while (s.tokenTimes.length && s.tokenTimes[0] < now - TPS_WINDOW_MS) s.tokenTimes.shift();
        s.streamBuf = (s.streamBuf + chunk).slice(-4000);
        this.dirty = true;
      });

      // Conversation history (without the message just added) makes follow-ups work.
      const hist = s.chat.getMessages().slice(0, -1)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-12)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4000) }));

      const mentions = this.loadMentions(request);
      const fullRequest = mentions ? `${request}\n\n${mentions}` : request;

      const agent = new InteractiveAgent(llm, this.cfg.projectDir, model, {
        onAction: line => {
          s.agentTools++;
          s.agentActivity = line;
          s.streamBuf = '';
          s.transcript.pushRaw('');
          s.transcript.pushRaw(`  ${c.accent('●')} ${c.text(line)}`);
          this.dirty = true;
        },
        onResult: line => {
          s.transcript.pushRaw(`    ${c.dim('⎿')}  ${c.muted(line)}`);
          this.dirty = true;
        },
        approveCommand: cmd => this.approveAgentCommand(s, cmd),
      }, s.abortCtrl.signal);

      const result = await agent.run(fullRequest, hist);
      ok = true;

      s.chat.addMessage('assistant', result.answer);
      this.totalTokens += result.totalTokens;
      this.costTracker.track(model, result.totalTokens, 0, request);

      s.transcript.pushRaw('');
      for (const line of result.answer.split('\n')) s.transcript.pushRaw(`  ${c.text(line)}`);
      if (result.filesChanged.length) {
        const names = result.filesChanged.slice(0, 5).join(', ')
          + (result.filesChanged.length > 5 ? ` +${result.filesChanged.length - 5} more` : '');
        s.transcript.pushRaw('');
        s.transcript.pushRaw(`  ${c.success('✓')} changed ${result.filesChanged.length} file${result.filesChanged.length > 1 ? 's' : ''}: ${c.text(names)}`);
        s.transcript.pushRaw(`  ${c.dim('/diff to review · /git commit <msg> to keep · /rollback to undo')}`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        s.transcript.pushRaw(`  ${c.warning('⏹ agent interrupted')} ${c.dim(`after ${formatDuration(Date.now() - s.pipelineStart)}`)}`);
      } else {
        s.transcript.push(errorCard({
          title: 'Agent error', message: err.message,
          hints: classifyError(err.message),
        }));
      }
    } finally {
      s.running       = false;
      s.abortCtrl     = null;
      s.streamBuf     = '';
      s.agentActivity = '';
      if (s !== this.active) s.unread = ok ? 'ok' : 'fail';
      this.dirty = true;
      this.drainQueue(s);
    }
  }

  /** Shell-command approval: PermissionSystem allowlist first, then a y/N prompt. */
  private approveAgentCommand(s: TuiSession, cmd: string): Promise<boolean> {
    return this.permissions
      .check('bash', cmd, msg => this.confirmAsync(s, `${msg} — agent wants to run: ${cmd}`))
      .then(v => v === 'allow');
  }

  /** Promise-flavored y/N confirm on the shared confirm flow (abort ⇒ deny). */
  private confirmAsync(s: TuiSession, message: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.awaitingConfirm = true;
      this.pendingConfirmAction = async () => resolve(true);
      this.pendingConfirmCancel = () => resolve(false);
      s.abortCtrl?.signal.addEventListener('abort', () => resolve(false), { once: true });
      s.transcript.push(confirmPrompt(message));
      s.transcript.toBottom();
      this.dirty = true;
    });
  }

  /** Read @-mentioned files into a context block for the agent. */
  private loadMentions(request: string): string {
    const blocks: string[] = [];
    for (const m of request.matchAll(/@([\w./\\-]+)/g)) {
      const full = path.resolve(this.cfg.projectDir, m[1]);
      if (!full.startsWith(path.resolve(this.cfg.projectDir))) continue;
      try {
        const lines = fs.readFileSync(full, 'utf-8').split('\n');
        const slice = lines.slice(0, 200).map((l, i) => `${String(i + 1).padStart(4)}| ${l}`);
        const more  = lines.length > 200 ? `\n… ${lines.length - 200} more lines (use read_file for the rest)` : '';
        blocks.push(`MENTIONED FILE ${m[1]} (${lines.length} lines):\n${slice.join('\n')}${more}`);
      } catch { /* not a real file — leave the mention as text */ }
    }
    return blocks.join('\n\n');
  }

  /** Run the next queued follow-up, if any. */
  private drainQueue(s: TuiSession): void {
    const next = s.queued.shift();
    if (next === undefined) return;
    s.transcript.pushRaw('');
    s.transcript.pushRaw(`  ${c.dim('❯')} ${c.text(next)} ${c.dim('(queued)')}`);
    s.transcript.toBottom();
    this.route(s, next).catch(() => {});
  }

  // ── Actions (ship / rollback / diff / files) ────────────────────────────────

  private async doShipIt(s: TuiSession): Promise<void> {
    if (!s.lastDeliverables) { s.transcript.pushRaw(`  ${c.muted('Nothing to ship.')}`); return; }
    const msg = `feat: ${(s.lastRequest || 'changes').slice(0, 72)}`;

    await this.runCaptured(s, async () => {
      const { spinner } = await import('../spinner.js');
      const { tray }    = await import('../notification-tray.js');
      spinner.start('Staging all changes…');
      try { await this.git.addAll(); }
      catch (err: any) { spinner.fail(`Stage failed: ${err.message}`); return; }

      spinner.setText('Committing…');
      try {
        const hash = await this.git.commit(msg);
        if (!hash) { spinner.stop(); s.transcript.pushRaw(`  ${c.muted('Nothing to commit — all clean.')}`); s.lastSuccess = false; return; }
        this.commitCount++;
        spinner.succeed(`Committed  ${hash.slice(0, 8)}  "${msg}"`);
        const hasRemote = await this.git.hasRemote();
        if (hasRemote) {
          spinner.start('Pushing to remote…');
          const pushed = await this.git.push();
          if (pushed) spinner.succeed('Pushed to remote');
          else        spinner.warn('Push failed — commit is local');
        } else {
          s.transcript.pushRaw(`  ${c.muted('No remote configured — commit is local only.')}`);
        }
        tray.success(`Committed ${hash.slice(0, 8)}`);
      } catch (err: any) {
        spinner.fail(`Commit failed: ${err.message}`);
      }
    });
    s.lastSuccess = false;
  }

  private async doRollback(s: TuiSession): Promise<void> {
    await this.runCaptured(s, async () => {
      const log = await this.git.getLog(1);
      if (!log.length) { s.transcript.pushRaw(`  ${c.muted('No commits to roll back.')}`); return; }
      s.transcript.pushRaw(`  ${c.warning('⚠')}  Last commit: ${log[0].hash} ${log[0].message}`);
      const ok = await this.git.stash();
      s.transcript.pushRaw(ok
        ? `  ${c.success('✓')} Changes stashed.  /git stash pop to restore.`
        : `  ${c.error('✗')} Stash failed.`);
    });
  }

  private async showDiff(s: TuiSession): Promise<void> {
    if (!s.lastDeliverables) {
      const diff = await this.git.getDiff().catch(() => '');
      if (!diff) { s.transcript.pushRaw(`  ${c.muted('No changes.')}`); return; }
      await this.runCaptured(s, () => { InteractiveDiffViewer.printDiff(diff); });
      return;
    }
    const d = s.lastDeliverables;
    const allDiffs = d.files_modified.map((f: any) => f.diff ?? '').join('\n');
    if (!allDiffs) { s.transcript.pushRaw(`  ${c.muted('No diffs in deliverables.')}`); return; }
    this.diffViewer.parse(allDiffs);
    await this.suspendTui(() => this.diffViewer.show());
  }

  private async openFileBrowser(s: TuiSession): Promise<void> {
    const result = await this.suspendTui(() => new FileBrowser(this.cfg.projectDir).show());
    if (result.action === 'open' && result.selected) {
      const fs = await import('node:fs');
      try {
        const content = fs.readFileSync(result.selected, 'utf-8');
        const lines   = content.split('\n');
        const rel     = result.selected.replace(this.cfg.projectDir, '').replace(/^[/\\]/, '');
        s.transcript.pushRaw('');
        s.transcript.pushRaw(`  ${c.accent(rel)}  ${c.dim(`${lines.length} lines`)}`);
        lines.slice(0, 60).forEach((l, i) =>
          s.transcript.pushRaw(`  ${c.muted(String(i + 1).padStart(4))}  ${l}`));
        if (lines.length > 60) s.transcript.pushRaw(c.dim(`  … ${lines.length - 60} more`));
      } catch {
        s.transcript.pushRaw(`  ${c.error('Cannot read:')} ${result.selected}`);
      }
    }
  }

  private async pickFile(s: TuiSession, filter?: string): Promise<void> {
    const selected = await this.suspendTui(() => FilePicker.pick(this.cfg.projectDir, filter));
    if (selected) {
      const rel = selected.replace(this.cfg.projectDir, '').replace(/^[/\\]/, '');
      s.transcript.pushRaw(`  ${c.success('✓')} ${c.text(rel)}`);
    }
  }

  /** /resume — prefill the input with the last pipeline request instead of
   *  just printing it, so ↵ reruns and editing tweaks it. */
  private resumePrefill(s: TuiSession): void {
    const state = loadPipelineState();
    if (!state?.request) {
      s.transcript.pushRaw(`  ${c.muted('No previous pipeline found.')}`);
      return;
    }
    const status = state.success === true  ? c.success('completed')
                 : state.success === false ? c.error('failed')
                 : c.warning('interrupted');
    s.transcript.pushRaw(`  ${c.dim('↺ last pipeline')} ${status}${c.dim(':')} ${c.text(state.request.slice(0, 100))}`);
    s.transcript.pushRaw(`  ${c.dim('prefilled below — ↵ runs it again, or edit it first')}`);
    this.editor.setLine(state.request);
    this.dirty = true;
  }

  // ── Command execution ───────────────────────────────────────────────────────

  private async runCmd(s: TuiSession, slash: string): Promise<void> {
    const result = findCommand(slash);
    if (!result) {
      s.transcript.pushRaw(`  ${c.error('Unknown:')} ${slash}  ${c.dim('(try /help)')}`);
      return;
    }
    await this.runCaptured(s, () =>
      result.command.execute(result.commandArgs ?? result.args, this.cmdCtx(s)));
  }

  private cmdCtx(s: TuiSession): CommandContext {
    return {
      session: s.chat, costTracker: this.costTracker,
      modelSelector: this.modelSelector, git: this.git, permissions: this.permissions,
      projectDir: this.cfg.projectDir,
      planMode: this.planMode,         setPlanMode:     m => { this.planMode = m; },
      streamOutput: this.streamOutput, setStreamOutput: o => { this.streamOutput = o; },
      compactAuto: this.compactAuto,   setCompactAuto:  o => { this.compactAuto = o; },
    };
  }

  /**
   * Run a function whose output should land in a specific session's transcript.
   * The global sink is already routing all stray writes; this just pins them to
   * `s` for the duration so commands print into the right session.
   */
  private async runCaptured(s: TuiSession, fn: () => Promise<unknown> | unknown): Promise<void> {
    const prev = this.sinkSession;
    this.sinkSession = s;
    try {
      await fn();
    } finally {
      this.flushSink();
      this.sinkSession = prev;
      this.screen.invalidate();
      s.transcript.toBottom();
      this.dirty = true;
    }
  }

  /**
   * Leave the alternate screen, run an interactive sub-UI (diff viewer, file
   * browser, setup wizard) on the normal buffer, then restore the TUI. The
   * output sink is lifted for the duration so the sub-UI can actually paint.
   */
  private async suspendTui<T>(fn: () => Promise<T> | T): Promise<T> {
    this.editor.pause();
    this.removeSink();
    this.screen.exit();
    process.stdout.write('\n');
    try {
      return await fn();
    } finally {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      this.installSink();
      this.screen.enter();
      this.editor.resume();
      this.dirty = true;
      this.renderFrame();
    }
  }

  private async refreshGit(): Promise<void> {
    try {
      const info = await this.git.getInfo();
      if (info.isRepo) { this.gitBranch = info.branch; this.gitDirty = !info.isClean; }
    } catch { /* silent */ }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function kfmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function titleFor(request: string): string {
  const clean = request.replace(/\s+/g, ' ').trim();
  if (clean.length <= 18) return clean;
  const cut = clean.lastIndexOf(' ', 18);
  return clean.slice(0, cut > 8 ? cut : 18) + '…';
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  return home && p.startsWith(home) ? '~' + p.slice(home.length).replace(/\\/g, '/') : p;
}

function truncTag(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Keep SGR color codes, drop cursor movement / clears / OSC / resets. */
function stripNonSgr(s: string): string {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, m => (m.endsWith('m') ? m : ''))
    .replace(/\x1B[c78]/g, '');
}
