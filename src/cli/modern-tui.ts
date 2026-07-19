// ── Sophos Modern TUI ─────────────────────────────────────────────────────────
// Enhanced terminal UI with modern design system and improved UX patterns
// Inspired by Claude Code and Grok Code

import { Screen } from './tui/screen.js';
import { Transcript } from './tui/transcript.js';
import { LineEditor } from './editor.js';
import { CommandPalette } from './command-palette.js';
import { ModelSelector } from './model-selector.js';
import { SessionManager } from './session.js';
import { GitIntegration } from './git-integration.js';
import { Orchestrator } from '../orchestrator.js';
import { InteractiveDiffViewer } from './diff-viewer.js';
import { FileBrowser, FilePicker } from './file-browser.js';

// Modern UI components
import { 
  c, COLORS, SPACING, TYPOGRAPHY, ICONS, ANIMATION,
  getTerminalWidth, createDivider, createSection,
  createBadge, createProgressBar, createPhaseDisplay,
  createTaskGrid, createStreamingOutput, createCard
} from './modern-ui.js';

// Legacy UI for compatibility
import {
  phaseCard, phaseLine, progressBar, banner, statusBar,
  welcomeCard, helpPanel, errorCard, shipItPanel, cancelCard,
  actionsBar, suggestionsBar, confirmPrompt, classifyError, 
  gradientText, shimmerText, asciiLogo, type PhaseCardStatus
} from './ui.js';

// ── Constants ────────────────────────────────────────────────────────────────
const FRAME_MS = 80;
const STREAM_TAIL = 8;
const CTRL_C_WINDOW_MS = 2000;

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

// ── Types ────────────────────────────────────────────────────────────────────
interface PhaseView {
  id:          string;
  name:        string;
  status:      PhaseCardStatus;
  startMs?:    number;
  durationMs?: number;
  progress?:   number; // 0-100 for running phases
  details?:    string[];
  collapsed?:  boolean;
}

interface TuiSession {
  id:         number;
  title:      string;
  transcript: Transcript;
  draft:      string;
  chat:       SessionManager;
  
  // Pipeline state
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
  
  // Post-run state
  lastSuccess:      boolean;
  lastDeliverables: any;
}

// ── Modern TUI App ───────────────────────────────────────────────────────────
export class ModernTuiApp {
  private screen:        Screen;
  private editor:        LineEditor | null = null;
  private palette:       CommandPalette | null = null;
  private sessions:      TuiSession[] = [];
  private activeIdx      = 0;
  private nextId         = 1;
  private frameTimer:    ReturnType<typeof setInterval> | null = null;
  private spinFrame      = 0;
  private tick           = 0;
  private dirty          = true;
  private quitting       = false;
  
  // Global state
  private sessionStart   = Date.now();
  private pipelineCount  = 0;
  private totalTokens    = 0;
  private commitCount    = 0;
  private lastCtrlC      = 0;
  
  // Services
  private modelSelector: ModelSelector;
  private git:           GitIntegration;
  private cfg:           any;
  
  constructor(config: any) {
    this.cfg = config;
    this.screen = new Screen();
    this.modelSelector = new ModelSelector();
    this.git = new GitIntegration(config.projectDir);
    this.setup();
  }
  
  // ── Lifecycle ──────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    this.screen.enter();
    this.setupEditor();
    this.setupInputHandling();
    this.startFrameLoop();
    this.renderWelcome();
  }
  
  private setup(): void {
    this.newSession();
    process.on('SIGINT', this.onSigInt.bind(this));
    process.on('exit', () => this.quit());
  }
  
  private setupEditor(): void {
    this.editor = new LineEditor({
      prompt: '❯ ',
      historyFile: '.sophos_history',
      onLine: this.onInput.bind(this),
      onKey: this.onEditorKey.bind(this),
      onTab: this.onTab.bind(this),
    });
    this.editor.start();
  }
  
  private setupInputHandling(): void {
    process.stdin.on('keypress', this.onKeypress.bind(this));
  }
  
  private startFrameLoop(): void {
    this.frameTimer = setInterval(() => this.tickFrame(), FRAME_MS);
  }
  
  // ── Input Handling ─────────────────────────────────────────────────────────
  private onInput(line: string): void {
    line = line.trim();
    if (!line) return;
    
    if (line === '/') {
      this.showCommandPalette();
      return;
    }
    
    if (line.startsWith('/')) {
      this.handleCommand(line.slice(1));
      return;
    }
    
    // Regular request
    this.startPipeline(line);
  }
  
  private onEditorKey(key: string, line: string): void {
    // Handle special keys
    switch (key) {
      case 'ctrl+c':
        this.handleCtrlC();
        break;
      case 'ctrl+l':
        this.clearScreen();
        break;
      case 'up':
      case 'down':
        // History navigation handled by LineEditor
        break;
    }
    this.dirty = true;
  }
  
  private onKeypress(ch: string, key?: any): void {
    if (!key) return;
    
    // Global shortcuts
    if (key.name === 'escape') {
      if (this.palette) {
        this.hideCommandPalette();
      } else if (this.active.running) {
        this.cancelPipeline();
      } else {
        this.editor?.clear();
      }
      this.dirty = true;
    } else if (key.ctrl && key.name === 'n') {
      this.newSession();
    } else if (key.ctrl && key.name === 'tab') {
      this.cycleSession(1);
    } else if (key.ctrl && key.shift && key.name === 'tab') {
      this.cycleSession(-1);
    }
  }
  
  private onTab(line: string, pos: number): string[] {
    // Simple command completion
    const commands = [
      '/models', '/diff', '/git', '/plan', '/security', 
      '/cost', '/config', '/status', '/clear', '/exit',
      '/webui', '/mcp', '/tunnel'
    ];
    
    if (line.startsWith('/')) {
      return commands.filter(cmd => 
        cmd.startsWith(line.toLowerCase())
      );
    }
    
    return [];
  }
  
  private handleCtrlC(): void {
    const now = Date.now();
    if (now - this.lastCtrlC < CTRL_C_WINDOW_MS) {
      this.quit();
    } else {
      this.lastCtrlC = now;
      if (this.active.running) {
        this.cancelPipeline();
      } else {
        this.editor?.clear();
      }
    }
    this.dirty = true;
  }
  
  private onSigInt(): void {
    this.handleCtrlC();
  }
  
  // ── Pipeline ───────────────────────────────────────────────────────────────
  private async startPipeline(request: string): Promise<void> {
    const session = this.active;
    if (session.running) return;
    
    session.running = true;
    session.pipelineStart = Date.now();
    session.lastRequest = request;
    session.tokenCount = 0;
    session.tokenTimes = [];
    session.streamBuf = '';
    session.streamAgent = '';
    session.notes = [];
    session.abortCtrl = new AbortController();
    
    // Reset phases
    this.initPhases(session);
    
    try {
      // Create orchestrator
      session.orch = new Orchestrator({
        targetDir: this.cfg.projectDir,
        request,
        config: this.cfg,
        abortSignal: session.abortCtrl.signal,
      });
      
      // Setup event listeners
      session.orch.on('phase:start', (phaseId: string) => {
        this.onPhaseStart(session, phaseId);
      });
      
      session.orch.on('phase:line', (phaseId: string, line: string) => {
        this.onPhaseLine(session, phaseId, line);
      });
      
      session.orch.on('phase:done', (phaseId: string, result: any) => {
        this.onPhaseDone(session, phaseId, result);
      });
      
      session.orch.on('phase:fail', (phaseId: string, error: any) => {
        this.onPhaseFail(session, phaseId, error);
      });
      
      session.orch.on('llm:token', (agent: string, token: string) => {
        this.onToken(session, agent, token);
      });
      
      // Run pipeline
      const result = await session.orch.run();
      
      // Handle completion
      session.lastSuccess = result.success;
      session.lastDeliverables = result.deliverables;
      this.pipelineCount++;
      
      if (result.success) {
        this.showShipItPanel(result);
      }
      
    } catch (error) {
      console.error('Pipeline error:', error);
      session.lastSuccess = false;
    } finally {
      session.running = false;
      session.orch = null;
      session.abortCtrl = null;
      this.dirty = true;
    }
  }
  
  private cancelPipeline(): void {
    const session = this.active;
    if (!session.running || !session.abortCtrl) return;
    
    session.abortCtrl.abort();
    session.running = false;
    
    // Calculate completion stats
    const phasesDone = Array.from(session.phases.values())
      .filter(p => p.status === 'passed' || p.status === 'failed').length;
    
    const activePhase = Array.from(session.phases.values())
      .find(p => p.status === 'running');
    
    // Show cancel card
    this.showCancelCard({
      request: session.lastRequest,
      phasesDone,
      phasesTotal: PHASE_ORDER.length,
      activePhase: activePhase?.name,
      elapsed: this.formatDuration(Date.now() - session.pipelineStart),
    });
  }
  
  // ── Phase Events ───────────────────────────────────────────────────────────
  private onPhaseStart(session: TuiSession, phaseId: string): void {
    const phase = session.phases.get(phaseId);
    if (phase) {
      phase.status = 'running';
      phase.startMs = Date.now();
      phase.collapsed = false;
      phase.progress = 0;
      phase.details = [];
    }
    this.dirty = true;
  }
  
  private onPhaseLine(session: TuiSession, phaseId: string, line: string): void {
    const phase = session.phases.get(phaseId);
    if (phase) {
      if (!phase.details) phase.details = [];
      phase.details.push(line);
      if (phase.details.length > 20) {
        phase.details = phase.details.slice(-20);
      }
    }
    this.dirty = true;
  }
  
  private onPhaseDone(session: TuiSession, phaseId: string, result: any): void {
    const phase = session.phases.get(phaseId);
    if (phase) {
      phase.status = 'passed';
      phase.durationMs = Date.now() - (phase.startMs || Date.now());
      phase.progress = 100;
    }
    this.dirty = true;
  }
  
  private onPhaseFail(session: TuiSession, phaseId: string, error: any): void {
    const phase = session.phases.get(phaseId);
    if (phase) {
      phase.status = 'failed';
      phase.durationMs = Date.now() - (phase.startMs || Date.now());
      if (!phase.details) phase.details = [];
      phase.details.push(`Error: ${error.message || error}`);
    }
    this.dirty = true;
  }
  
  private onToken(session: TuiSession, agent: string, token: string): void {
    session.streamAgent = agent;
    session.streamBuf += token;
    session.tokenCount++;
    session.tokenTimes.push(Date.now());
    
    // Keep only recent tokens for TPS calculation
    const windowMs = 5000;
    const cutoff = Date.now() - windowMs;
    session.tokenTimes = session.tokenTimes.filter(t => t > cutoff);
    
    this.dirty = true;
  }
  
  // ── UI Rendering ───────────────────────────────────────────────────────────
  private tickFrame(): void {
    this.spinFrame = (this.spinFrame + 1) % ANIMATION.frames.spinner.length;
    this.tick++;
    
    // Update running phase progress
    const session = this.active;
    if (session.running) {
      for (const phase of session.phases.values()) {
        if (phase.status === 'running' && phase.startMs) {
          const elapsed = Date.now() - phase.startMs;
          // Simple progress simulation (0-80% while running, 100% on done)
          phase.progress = Math.min(80, Math.floor(elapsed / 1000) * 10);
        }
      }
    }
    
    if (this.dirty || session.running) {
      this.renderFrame();
    }
  }
  
  private renderFrame(): void {
    if (this.quitting || !this.screen.isActive()) return;
    
    const { rows, cursor } = this.composeFrame();
    this.screen.render(rows, cursor);
    this.dirty = false;
  }
  
  private composeFrame(): { rows: string[]; cursor: { row: number; col: number } | null } {
    const width = this.screen.cols;
    const height = this.screen.rows;
    const session = this.active;
    
    const rows: string[] = [];
    
    // ── Header ──────────────────────────────────────────────────────────────
    rows.push(this.renderHeader(width));
    
    // ── Main Content ────────────────────────────────────────────────────────
    const contentHeight = height - 6; // Header + status + input + footer
    
    if (session.running || session.phases.size > 0) {
      // Pipeline view
      rows.push(...this.renderPipelineView(session, width, contentHeight));
    } else {
      // Welcome/Idle view
      rows.push(...this.renderIdleView(width, contentHeight));
    }
    
    // ── Status Bar ──────────────────────────────────────────────────────────
    rows.push(createDivider('─', width));
    rows.push(this.renderStatusBar(session, width));
    rows.push(createDivider('─', width));
    
    // ── Input Line ──────────────────────────────────────────────────────────
    const inputLine = this.editor?.render() || '';
    rows.push(inputLine);
    
    // ── Footer ──────────────────────────────────────────────────────────────
    rows.push(this.renderFooter(session, width));
    
    // ── Cursor ──────────────────────────────────────────────────────────────
    const cursor = this.editor?.getCursor();
    
    return { rows, cursor };
  }
  
  private renderHeader(width: number): string {
    const session = this.active;
    const title = session.title || `Session ${session.id}`;
    const sessionBadge = createBadge(`session ${session.id}`, { color: 'purple', size: 'sm' });
    const model = this.modelSelector.getCurrentModel();
    const modelBadge = model ? createBadge(model, { color: 'cyan', size: 'sm' }) : '';
    
    const left = `${c.primary.bold('◆ Sophos')} ${c.dim('·')} ${c.text(title)} ${sessionBadge}`;
    const right = [modelBadge].filter(Boolean).join(' ');
    
    const gap = Math.max(2, width - left.length - right.length - 4);
    return ` ${left}${' '.repeat(gap)}${right}`;
  }
  
  private renderPipelineView(session: TuiSession, width: number, height: number): string[] {
    const rows: string[] = [];
    const phases = Array.from(session.phases.values());
    
    // Calculate how many phases we can show
    const phaseRows = Math.min(phases.length, Math.floor(height * 0.6));
    
    // Show active/running phases first, then completed
    const visiblePhases = phases
      .sort((a, b) => {
        // Running first
        if (a.status === 'running' && b.status !== 'running') return -1;
        if (b.status === 'running' && a.status !== 'running') return 1;
        // Then by order
        return PHASE_ORDER.indexOf(a.id) - PHASE_ORDER.indexOf(b.id);
      })
      .slice(0, phaseRows);
    
    // Render phases
    for (const phase of visiblePhases) {
      const display = createPhaseDisplay({
        number: PHASE_ORDER.indexOf(phase.id) + 1,
        name: phase.name,
        status: phase.status,
        durationMs: phase.durationMs,
        progress: phase.progress,
        details: phase.details,
        collapsed: phase.collapsed,
        width: width - 4,
      });
      
      rows.push(` ${display}`);
    }
    
    // Add streaming output if active
    if (session.streamBuf && session.running) {
      rows.push('');
      const streamOutput = createStreamingOutput({
        text: session.streamBuf,
        agent: session.streamAgent,
        tokenCount: session.tokenCount,
        elapsedMs: session.running ? Date.now() - session.pipelineStart : undefined,
        showCursor: true,
        width: width - 4,
      });
      rows.push(` ${streamOutput}`);
    }
    
    return rows;
  }
  
  private renderIdleView(width: number, height: number): string[] {
    const rows: string[] = [];
    
    // Welcome card for first session
    if (this.sessions.length === 1 && this.pipelineCount === 0) {
      const welcome = welcomeCard({
        projectName: this.cfg.projectName || 'Untitled',
        projectDir: this.cfg.projectDir,
        branch: this.git.getCurrentBranch(),
        dirty: this.git.isDirty(),
        ollamaOnline: true, // TODO: Check Ollama status
        model: this.modelSelector.getCurrentModel(),
      });
      rows.push(...welcome.split('\n'));
    } else {
      // Simple idle state
      const idleCard = createCard([
        c.text.bold('Ready for your next request'),
        '',
        c.dim('Describe what you want to build, analyze, or fix.'),
        c.dim('Examples:'),
        `  ${c.primary('"add user authentication with JWT"')}`,
        `  ${c.primary('"fix the login race condition"')}`,
        `  ${c.primary('"refactor the API endpoints"')}`,
        '',
        c.dim('Type / for commands, or start typing your request.'),
      ], {
        title: 'Sophos',
        border: true,
        width: Math.min(width - 4, 80),
      });
      
      rows.push(...idleCard.split('\n'));
    }
    
    return rows;
  }
  
  private renderStatusBar(session: TuiSession, width: number): string {
    const parts: string[] = [];
    
    // Session info
    if (this.sessions.length > 1) {
      parts.push(`${c.dim('session')} ${c.accent(`${session.id}/${this.sessions.length}`)}`);
    }
    
    // Pipeline status
    if (session.running) {
      const elapsed = Date.now() - session.pipelineStart;
      parts.push(`${c.warning('▶')} ${c.dim(this.formatDuration(elapsed))}`);
      
      // Tokens per second
      if (session.tokenTimes.length >= 2) {
        const windowMs = 5000;
        const recent = session.tokenTimes.filter(t => Date.now() - t < windowMs);
        if (recent.length >= 2) {
          const tps = (recent.length - 1) / ((recent[recent.length - 1] - recent[0]) / 1000);
          parts.push(`${c.dim(Math.round(tps))} ${c.dim('tps')}`);
        }
      }
    }
    
    // Git branch
    const branch = this.git.getCurrentBranch();
    if (branch) {
      const dirty = this.git.isDirty();
      parts.push(`${dirty ? c.warning('⎇') : c.dim('⎇')} ${c.text(branch)}${dirty ? c.warning('*') : ''}`);
    }
    
    // Right-aligned items
    const rightParts: string[] = [];
    
    // Model
    const model = this.modelSelector.getCurrentModel();
    if (model) {
      rightParts.push(`${c.dim('model:')} ${c.cyan(model)}`);
    }
    
    // Build the status line
    const left = parts.join(c.dim('  ·  '));
    const right = rightParts.join(c.dim('  ·  '));
    
    const gap = Math.max(2, width - left.length - right.length - 4);
    return ` ${left}${' '.repeat(gap)}${right}`;
  }
  
  private renderFooter(session: TuiSession, width: number): string {
    const hints: string[] = [];
    
    if (session.running) {
      hints.push(`${c.warning('esc')} interrupt`);
    } else {
      hints.push(`${c.primary('/')} commands`);
      hints.push(`${c.primary('tab')} complete`);
    }
    
    hints.push(`${c.primary('ctrl+c')} clear`);
    hints.push(`${c.primary('ctrl+n')} new session`);
    
    const hintText = hints.join(c.dim('  ·  '));
    const gap = Math.max(2, width - hintText.length - 4);
    return ` ${' '.repeat(gap)}${hintText}`;
  }
  
  private renderWelcome(): void {
    this.dirty = true;
  }
  
  private clearScreen(): void {
    this.screen.clear();
    this.dirty = true;
  }
  
  // ── Session Management ──────────────────────────────────────────────────────
  private get active(): TuiSession {
    return this.sessions[this.activeIdx];
  }
  
  private newSession(): void {
    const session: TuiSession = {
      id: this.nextId++,
      title: '',
      transcript: new Transcript(),
      draft: '',
      chat: new SessionManager(this.cfg.model || 'auto', this.cfg.projectDir),
      running: false,
      pipelineStart: 0,
      lastRequest: '',
      phases: new Map(),
      streamBuf: '',
      streamAgent: '',
      tokenCount: 0,
      tokenTimes: [],
      notes: [],
      abortCtrl: null,
      orch: null,
      lastSuccess: false,
      lastDeliverables: null,
    };
    
    this.initPhases(session);
    this.sessions.push(session);
    this.switchTo(this.sessions.length - 1);
  }
  
  private switchTo(idx: number): void {
    if (idx < 0 || idx >= this.sessions.length) return;
    
    // Save current draft
    if (this.editor && this.sessions[this.activeIdx]) {
      this.sessions[this.activeIdx].draft = this.editor.getLine();
    }
    
    this.activeIdx = idx;
    
    // Restore draft
    if (this.editor) {
      this.editor.setLine(this.active.draft || '');
    }
    
    this.dirty = true;
  }
  
  private cycleSession(delta: number): void {
    if (this.sessions.length < 2) return;
    this.switchTo((this.activeIdx + delta + this.sessions.length) % this.sessions.length);
  }
  
  private initPhases(session: TuiSession): void {
    session.phases.clear();
    for (const id of PHASE_ORDER) {
      session.phases.set(id, { 
        id, 
        name: PHASE_NAMES[id] ?? id, 
        status: 'pending',
        collapsed: true,
      });
    }
  }
  
  // ── Command Palette ────────────────────────────────────────────────────────
  private showCommandPalette(): void {
    this.palette = new CommandPalette({
      width: Math.min(this.screen.cols - 4, 80),
      onSelect: (cmd: string) => {
        this.hideCommandPalette();
        this.handleCommand(cmd);
      },
      onCancel: () => this.hideCommandPalette(),
    });
    this.palette.show();
    this.dirty = true;
  }
  
  private hideCommandPalette(): void {
    if (this.palette) {
      this.palette.hide();
      this.palette = null;
    }
    this.dirty = true;
  }
  
  // ── Command Handling ───────────────────────────────────────────────────────
  private async handleCommand(cmd: string): Promise<void> {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    switch (command) {
      case 'models':
        await this.handleModelsCommand(args);
        break;
      case 'diff':
        this.showDiffViewer();
        break;
      case 'git':
        await this.handleGitCommand(args);
        break;
      case 'plan':
        this.togglePlanMode(args[0] === 'on');
        break;
      case 'clear':
        this.clearScreen();
        break;
      case 'exit':
        this.quit();
        break;
      case 'help':
        this.showHelp();
        break;
      default:
        this.showError(`Unknown command: /${command}`);
    }
  }
  
  private async handleModelsCommand(args: string[]): Promise<void> {
    if (args.length === 0) {
      // Show model table
      this.showModelTable();
    } else if (args[0] === 'assign') {
      // Interactive model selector
      await this.showModelSelector();
    } else {
      this.showError(`Unknown models command: ${args.join(' ')}`);
    }
  }
  
  private async handleGitCommand(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.showError('Git command required (status, log, commit, etc.)');
      return;
    }
    
    const subcmd = args[0].toLowerCase();
    try {
      switch (subcmd) {
        case 'status':
          const status = await this.git.status();
          this.showGitStatus(status);
          break;
        case 'log':
          const n = args[1] ? parseInt(args[1]) : 10;
          const log = await this.git.log(n);
          this.showGitLog(log);
          break;
        default:
          this.showError(`Unknown git command: ${subcmd}`);
      }
    } catch (error) {
      this.showError(`Git error: ${error.message}`);
    }
  }
  
  private togglePlanMode(enabled: boolean): void {
    this.cfg.planMode = enabled;
    this.showNotification({
      type: 'info',
      message: `Plan mode ${enabled ? 'enabled' : 'disabled'}`,
    });
  }
  
  // ── UI Dialogs ─────────────────────────────────────────────────────────────
  private showModelTable(): void {
    // TODO: Implement model table display
    this.showNotification({
      type: 'info',
      message: 'Model table display coming soon',
    });
  }
  
  private async showModelSelector(): Promise<void> {
    try {
      const selected = await this.modelSelector.interactiveSelect();
      if (selected) {
        this.showNotification({
          type: 'success',
          message: `Model set to: ${selected}`,
        });
      }
    } catch (error) {
      this.showError(`Model selection failed: ${error.message}`);
    }
  }
  
  private showDiffViewer(): void {
    const diffViewer = new InteractiveDiffViewer(this.cfg.projectDir);
    diffViewer.show();
  }
  
  private showGitStatus(status: any): void {
    // TODO: Implement git status display
    this.showNotification({
      type: 'info',
      message: `Git status: ${status.files?.length || 0} files changed`,
    });
  }
  
  private showGitLog(log: any[]): void {
    // TODO: Implement git log display
    this.showNotification({
      type: 'info',
      message: `Showing ${log.length} commits`,
    });
  }
  
  private showHelp(): void {
    const help = helpPanel('v3.2');
    // TODO: Display help in a scrollable view
    console.log(help);
  }
  
  private showShipItPanel(result: any): void {
    const panel = shipItPanel({
      phases: result.phasesCompleted || 9,
      tests: result.testsRun || 0,
      vulns: result.vulnerabilitiesFound || 0,
      duration: this.formatDuration(result.durationMs || 0),
      diffStats: result.diffStats,
    });
    
    // TODO: Display ship it panel
    console.log(panel);
  }
  
  private showCancelCard(opts: any): void {
    const card = cancelCard(opts);
    // TODO: Display cancel card
    console.log(card);
  }
  
  private showNotification(notification: { type: 'info' | 'success' | 'warning' | 'error'; message: string }): void {
    // TODO: Implement notification system
    const icon = 
      notification.type === 'success' ? c.success('✓') :
      notification.type === 'warning' ? c.warning('⚠') :
      notification.type === 'error'   ? c.error('✗')   : c.info('i');
    
    console.log(` ${icon} ${notification.message}`);
  }
  
  private showError(message: string): void {
    this.showNotification({ type: 'error', message });
  }
  
  // ── Utilities ──────────────────────────────────────────────────────────────
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  
  // ── Cleanup ────────────────────────────────────────────────────────────────
  private quit(): void {
    if (this.quitting) return;
    this.quitting = true;
    
    // Stop frame loop
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    
    // Abort running pipelines
    for (const session of this.sessions) {
      session.abortCtrl?.abort();
    }
    
    // Cleanup editor
    this.editor?.destroy();
    
    // Exit screen
    this.screen.destroy();
    
    // Show goodbye
    const goodbye = `
${createDivider(getTerminalWidth())}

${c.primary.bold('◆ Sophos')} ${c.dim('session complete')}

${c.dim('Session duration:')} ${this.formatDuration(Date.now() - this.sessionStart)}
${c.dim('Pipelines run:')} ${c.accent(this.pipelineCount)}
${c.dim('Total tokens:')} ${c.cyan(this.totalTokens.toLocaleString())}

${c.dim('Goodbye 👋')}

${createDivider(getTerminalWidth())}
`;
    
    process.stdout.write(goodbye + '\n');
    process.exit(0);
  }
}