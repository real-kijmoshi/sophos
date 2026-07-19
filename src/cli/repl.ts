// ── SOPHOS REPL — frontier-style interactive shell ────────────────────────────
// Input is a custom LineEditor (not readline): a minimal ❯ prompt with a live
// region below it that hosts the slash-command palette and a dim status line.
// Typing “/” opens the palette (↑↓ select · tab complete · ↵ run · esc dismiss),
// Ctrl+C clears the line and quits on a double press, Esc interrupts pipelines.

import * as path from 'node:path';
import pkg from '../../package.json';
import {
  welcomeCard, suggestionsBar, shipItPanel,
  helpPanel, errorCard, goodbyeCard, contextLine, classifyError,
  actionsBar, confirmPrompt, cancelCard, inputStatusLine,
  c, formatDuration, ANSI,
} from './ui.js';
import { parseIntent, generateSuggestions, type SuggestionContext } from './intent-parser.js';
import { phaseRenderer }       from './phase-renderer.js';
import { spinner }             from './spinner.js';
import { tray }                from './notification-tray.js';
import { SessionManager }      from './session.js';
import { CostTracker }         from './cost-tracker.js';
import { ModelSelector }       from './model-selector.js';
import { GitIntegration }      from './git-integration.js';
import { PermissionSystem }    from './permissions.js';
import { findCommand, type CommandContext } from './commands.js';
import { Orchestrator }        from '../orchestrator.js';
import { loadConfig }          from '../config/config.js';
import { ProjectStore }        from '../config/project-store.js';
import { PipelineKeyboardController } from './pipeline-controller.js';
import { InteractiveDiffViewer } from './diff-viewer.js';
import { FileBrowser, FilePicker } from './file-browser.js';
import { savePipelineState, setProjectStore } from './pipeline-state.js';
import { LineEditor }     from './editor.js';
import { CommandPalette } from './command-palette.js';
import type { OrchestratorConfig } from '../types.js';

const CTRL_C_WINDOW_MS = 2000;

export interface REPLConfig {
  projectDir: string;
  model?:     string;
  verbose?:   boolean;
  dryRun?:    boolean;
}

export class SophosREPL {
  private editor!:       LineEditor;
  private palette      = new CommandPalette();
  private session:       SessionManager;
  private costTracker:   CostTracker;
  private modelSelector: ModelSelector;
  private git:           GitIntegration;
  private permissions:   PermissionSystem;

  private planMode     = false;
  private streamOutput = true;
  private compactAuto  = true;
  private running      = false;
  private processing   = false;
  private abortCtrl:   AbortController | null = null;
  private history:     string[] = [];
  private recentIntents: string[] = [];

  // double Ctrl+C to quit
  private ctrlCArmed = false;
  private ctrlCTimer: ReturnType<typeof setTimeout> | null = null;

  // session stats for goodbye card
  private sessionStart  = Date.now();
  private pipelineCount = 0;
  private totalTokens   = 0;
  private commitCount   = 0;

  // SHIP IT state
  private lastSuccess      = false;
  private lastDeliverables: any = null;

  // git context
  private gitBranch = '';
  private gitDirty  = false;

  // interactive components
  private pipelineKb:     PipelineKeyboardController | null = null;
  private diffViewer      = new InteractiveDiffViewer();
  private awaitingConfirm = false;

  // project store
  private projectStore: ProjectStore;
  private pipelineStart   = 0;
  private lastPipelineRequest = '';

  // suggestion context (populated during background init)
  private suggestionCtx: SuggestionContext = {};

  constructor(private cfg: REPLConfig) {
    this.session       = new SessionManager(cfg.model || 'auto', cfg.projectDir);
    this.costTracker   = new CostTracker();
    this.modelSelector = new ModelSelector(cfg.model || undefined);
    this.git           = new GitIntegration(cfg.projectDir);
    this.permissions   = new PermissionSystem();

    this.projectStore = new ProjectStore(cfg.projectDir);
    this.projectStore.init();
    setProjectStore(this.projectStore);
  }

  // ── Start ─────────────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    this.running = true;
    if (process.stdout.isTTY) process.stdout.write(ANSI.clearScreen);

    this.editor = new LineEditor({
      prompt:    () => this.makePrompt(),
      below:     () => this.belowRegion(),
      intercept: (str, key) => this.interceptKey(str, key),
      onChange:  line => this.palette.update(line),
      onSubmit:  line => { this.handleSubmit(line).catch(() => {}); },
      onCtrlC:   () => this.handleCtrlC(),
      onCtrlKey: name => this.handleCtrlKey(name),
      onEof:     () => { this.goodbye(); process.exit(0); },
      history:   this.history,
      historySize: 200,
    });

    // Prompt is live immediately — heavy init never blocks typing
    this.editor.start();
    this.backgroundInit().catch(() => {});
  }

  // ── Background init ───────────────────────────────────────────────────────────
  private async backgroundInit(): Promise<void> {
    const [gitInfo] = await Promise.all([
      this.git.getInfo().catch(() => null),
      this.modelSelector.discover().catch(() => {}),
    ]);

    if (gitInfo?.isRepo) {
      this.gitBranch = gitInfo.branch;
      this.gitDirty  = !gitInfo.isClean;
      if (!gitInfo.isClean) tray.warning('Uncommitted changes in working tree');
      this.suggestionCtx.branch = gitInfo.branch;
      this.suggestionCtx.dirty  = !gitInfo.isClean;
      this.suggestionCtx.recentFiles = [
        ...gitInfo.staged,
        ...gitInfo.modified,
        ...gitInfo.notAdded,
      ].slice(0, 20);
    }

    const online = this.modelSelector.isOllamaOnline();
    const model  = this.modelSelector.getCurrentModel();

    // Paint the welcome card over the empty prompt row, then restore the prompt
    this.editor.pause();
    process.stdout.write('\r\x1B[0J');
    process.stdout.write(welcomeCard({
      projectName:  path.basename(this.cfg.projectDir),
      projectDir:   this.cfg.projectDir,
      branch:       this.gitBranch || undefined,
      dirty:        this.gitDirty,
      ollamaOnline: online,
      model:        model || undefined,
      version:      'v3.2',
    }));

    if (!online) {
      this.modelSelector.printOllamaOffline();
    } else if (!model) {
      await this.modelSelector.runSetupWizard('local');
    }

    if (this.running) this.editor.resume();
  }

  // ── Prompt + live region ──────────────────────────────────────────────────────
  private makePrompt(): string {
    const glyph = this.awaitingConfirm ? c.warning('❯')
      : this.planMode                  ? c.warning('❯')
      : c.accent('❯');
    return `${glyph} `;
  }

  private belowRegion(): string[] {
    if (this.palette.visible) return this.palette.renderLines();

    const hint = this.ctrlCArmed
      ? 'ctrl+c again to exit'
      : this.awaitingConfirm ? 'y to confirm · anything else cancels'
      : this.lastSuccess     ? 's ship · d diff · r review · a abort'
      : this.editor?.getLine() ? '↵ send · esc clear'
      : '/ commands · tab complete · ↑ history';

    return [inputStatusLine({
      online:   this.modelSelector.isOllamaOnline(),
      model:    this.modelSelector.getCurrentModel() ?? undefined,
      branch:   this.gitBranch || undefined,
      dirty:    this.gitDirty,
      planMode: this.planMode,
      tokens:   this.totalTokens,
      hint,
    })];
  }

  // ── Key routing ───────────────────────────────────────────────────────────────
  private interceptKey(_str: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }): boolean {
    if (this.ctrlCArmed && !(key.ctrl && key.name === 'c')) this.disarmCtrlC();

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
        if (item) {
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
    // LineEditor already cleared a non-empty line before calling us.
    if (this.editor.getLine().length > 0) return;
    if (this.ctrlCArmed) {
      this.goodbye();
      process.exit(0);
    }
    this.ctrlCArmed = true;
    this.ctrlCTimer = setTimeout(() => this.disarmCtrlC(), CTRL_C_WINDOW_MS);
    this.editor.refresh();
  }

  private disarmCtrlC(): void {
    this.ctrlCArmed = false;
    if (this.ctrlCTimer) { clearTimeout(this.ctrlCTimer); this.ctrlCTimer = null; }
    this.editor.refresh();
  }

  private handleCtrlKey(name: string): boolean {
    switch (name) {
      case 'n':
        this.printAround(async () => { tray.showFull(); });
        return true;
      case 'd':
        if (this.lastSuccess || this.lastDeliverables) {
          this.printAround(() => this.showDiff());
        } else {
          this.printAround(async () => this.print(`  ${c.muted('No recent changes to diff.')}\n`));
        }
        return true;
    }
    return false;
  }

  /** Pause the prompt, run a printing action, then restore the prompt. */
  private printAround(fn: () => Promise<void>): void {
    if (this.processing) return;
    this.editor.pause();
    process.stdout.write('\n');
    fn()
      .catch(() => {})
      .finally(() => { if (this.running) this.editor.resume(); });
  }

  // ── Submission ────────────────────────────────────────────────────────────────
  private async handleSubmit(raw: string): Promise<void> {
    const input = raw.trim();
    this.palette.hide();
    if (!input) { this.editor.resume(); return; }

    await this.route(input);

    if (this.running) {
      this.refreshGit().catch(() => {});
      tray.printIfAny();
      this.editor.resume();
    }
  }

  // ── Router ────────────────────────────────────────────────────────────────────
  private async route(input: string): Promise<void> {
    // Confirmation flow — waiting for y/N
    if (this.awaitingConfirm) {
      this.awaitingConfirm = false;
      if (/^(y|yes)$/i.test(input)) {
        await this.pendingConfirmAction?.();
      } else {
        this.print(`  ${c.muted('Cancelled.\n')}`);
      }
      this.pendingConfirmAction = null;
      return;
    }

    // Post-pipeline shortcuts (single-key and full words)
    if (this.lastSuccess) {
      if (/^(s|ship(\s+it)?)$/i.test(input))    { await this.doShipIt(); return; }
      if (/^(d|diff)$/i.test(input))             { await this.showDiff(); return; }
      if (/^(r|review)$/i.test(input))           { await this.runCmd('/review'); return; }
      if (/^(a|abort)$/i.test(input))            { this.lastSuccess = false; this.print(`\n  ${c.muted('Aborted.\n')}`); return; }
    }

    // File browser shortcuts
    if (/^(f|files|browse)$/i.test(input)) { await this.openFileBrowser(); return; }
    if (/^pick\s*(.*)$/i.test(input)) {
      const filter = input.match(/^pick\s*(.*)$/i)?.[1]?.trim();
      await this.pickFile(filter);
      return;
    }

    const intent = parseIntent(input);

    switch (intent.type) {
      case 'exit':    this.goodbye(); process.exit(0); return;
      case 'help':    this.print(helpPanel(pkg.version)); return;
      case 'command': await this.runCmd('/' + input.replace(/^\//, '')); return;
      case 'rollback':await this.confirmAction('This will stash your current changes.', () => this.doRollback()); return;
      case 'git':     await this.runCmd('/git ' + (intent.gitOp || 'status')); return;
      case 'view':    await this.runCmd('/inspect ' + (intent.viewTarget || input)); return;
      case 'explain': await this.doPipeline(`Explain: ${intent.explainTarget || input}`, true); return;
      case 'model':
        if (intent.modelOverride) {
          this.modelSelector.setCurrentModel(intent.modelOverride.model);
          this.print(`\n  ${c.success('✓')} Model → ${c.accent(intent.modelOverride.model)}\n`);
        }
        return;
      default: {
        const req  = intent.pipelineRequest || input;
        const plan = intent.planOnly || this.planMode;
        this.recentIntents.push(req);
        const sugg = generateSuggestions(req, this.recentIntents, this.suggestionCtx);
        if (sugg.length && !plan) this.print('\n' + suggestionsBar(sugg) + '\n');
        await this.doPipeline(req, plan);
      }
    }
  }

  // ── Confirmation system ─────────────────────────────────────────────────────
  private pendingConfirmAction: (() => Promise<void>) | null = null;

  private async confirmAction(message: string, action: () => Promise<void>): Promise<void> {
    this.awaitingConfirm = true;
    this.pendingConfirmAction = action;
    this.print(confirmPrompt(message) + '\n');
  }

  // ── Pipeline ──────────────────────────────────────────────────────────────────
  private async doPipeline(request: string, planOnly = false): Promise<void> {
    if (!this.modelSelector.isOllamaOnline()) {
      this.print(errorCard({ title: 'Ollama not running', message: 'connect ECONNREFUSED 127.0.0.1:11434' }));
      return;
    }
    if (!this.modelSelector.getCurrentModel()) {
      this.print(`\n  ${c.warning('⚠')} No model configured.\n`);
      await this.modelSelector.runSetupWizard('local');
      if (!this.modelSelector.getCurrentModel()) return;
    }

    this.processing = true;
    this.abortCtrl  = new AbortController();
    this.lastSuccess = false;
    this.lastDeliverables = null;
    this.pipelineCount++;
    this.pipelineStart = Date.now();
    this.lastPipelineRequest = request;

    // Save pipeline state for resume support
    savePipelineState({
      request,
      targetDir:  this.cfg.projectDir,
      planOnly,
      model:      this.modelSelector.getCurrentModel() ?? undefined,
      startedAt:  this.pipelineStart,
      phases:     [],
    });

    if (this.compactAuto && this.session.isNearLimit()) {
      const r = await this.session.compact();
      tray.info(`Compacted: saved ${r.tokensSaved} tokens`);
    }
    this.session.addMessage('user', request);

    if (planOnly) this.print(`  ${c.warning('plan mode — no file writes')}\n`);

    phaseRenderer.reset();
    phaseRenderer.setRequest(request);
    phaseRenderer.begin();

    // Keyboard controls during pipeline (↑↓ navigate · esc interrupt)
    this.pipelineKb = new PipelineKeyboardController();
    this.pipelineKb.start(this.abortCtrl);

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

      orch.on('phase:start', e => phaseRenderer.onEvent({ type: 'phase_start', phaseId: e.phaseId }));
      orch.on('phase:line',  e => phaseRenderer.onEvent({ type: 'phase_line',  phaseId: e.phaseId, line: e.line }));
      orch.on('phase:done',  e => {
        phaseRenderer.onEvent({ type: 'phase_done', phaseId: e.phaseId, durationMs: e.durationMs });
        tray.success(`${e.phaseName} (${formatDuration(e.durationMs)})`);
      });
      orch.on('phase:fail',  e => {
        phaseRenderer.onEvent({ type: 'phase_fail', phaseId: e.phaseId, durationMs: e.durationMs });
        tray.error(`${e.phaseName} failed`);
      });
      orch.on('task:update', e => phaseRenderer.onEvent({ type: 'task_update', taskRow: e }));
      orch.on('llm:token',   e => {
        const active = phaseRenderer.getActivePhase();
        phaseRenderer.onEvent({ type: 'llm_token', phaseId: active?.id, token: e.chunk, agentName: e.agentName });
      });

      const result = await orch.execute(this.abortCtrl.signal);

      if (this.pipelineKb) { this.pipelineKb.stop(); this.pipelineKb = null; }
      phaseRenderer.finalize();

      if (result.deliverables) {
        this.session.addMessage('assistant', result.deliverables.executive_summary);
        const llm = result.deliverables.llm_stats;
        if (llm) {
          this.totalTokens += llm.total_tokens;
          this.costTracker.track(this.modelSelector.getCurrentModel(), llm.total_tokens, 0, request);
        }
        this.lastDeliverables = result.deliverables;
        this.lastSuccess      = result.success;

        if (result.success) {
          const d       = result.deliverables;
          const vulns   = d.security_report?.length ?? 0;
          const tests   = d.test_results ? d.test_results.passed + d.test_results.failed : 0;
          const summary = phaseRenderer.getSummary();
          const allDiffs = d.files_modified.map((f: any) => f.diff ?? '').join('\n');
          const diffStats = {
            added:   (allDiffs.match(/^\+(?!\+\+)/mg) ?? []).length,
            removed: (allDiffs.match(/^-(?!--)/mg)    ?? []).length,
            files:   d.files_modified.length + d.files_created.length,
          };
          this.print(shipItPanel({
            phases: summary.done, tests, vulns, diffStats,
            files:     d.files_created.length + d.files_modified.length,
            duration:  formatDuration(Date.now() - this.pipelineStart),
            commitMsg: `feat: ${request.slice(0, 60)}`,
          }));
          this.print('\n' + actionsBar({
            canShip:  true,
            canDiff:   true,
            hasFiles:  diffStats.files > 0,
          }) + '\n');
        } else {
          this.print(errorCard({ title: 'Pipeline finished with errors', message: 'One or more phases failed.' }));
        }
      } else {
        this.print(errorCard({ title: 'Pipeline failed', message: 'No deliverables returned.' }));
      }
    } catch (err: any) {
      if (this.pipelineKb) { this.pipelineKb.stop(); this.pipelineKb = null; }
      if (err.name === 'AbortError') {
        const active = phaseRenderer.getActivePhase();
        phaseRenderer.abort();
        phaseRenderer.finalize();
        const summary = phaseRenderer.getSummary();
        this.print(cancelCard({
          request:      this.lastPipelineRequest,
          phasesDone:   summary.done,
          phasesTotal:  summary.total,
          activePhase:  active?.name ?? 'pipeline',
          elapsed:      formatDuration(Date.now() - this.pipelineStart),
          filesChanged: summary.filesChanged,
        }));
      } else {
        phaseRenderer.finalize();
        this.print(errorCard({ title: 'Error', message: err.message, hints: classifyError(err.message), raw: err.stack?.split('\n').slice(0, 4).join('\n') }));
      }
    } finally {
      this.processing  = false;
      this.abortCtrl   = null;

      // Update pipeline state on completion
      const summary = phaseRenderer.getSummary();
      savePipelineState({
        request,
        targetDir:   this.cfg.projectDir,
        planOnly,
        model:       this.modelSelector.getCurrentModel() ?? undefined,
        startedAt:   this.pipelineStart,
        completedAt: Date.now(),
        success:     this.lastSuccess,
        phases:      Object.values(summary as any),
      });

      try {
        const info = await this.git.getInfo();
        this.print('\n' + contextLine({ projectDir: this.cfg.projectDir, branch: info.branch, dirty: !info.isClean, model: this.modelSelector.getCurrentModel() ?? undefined, tokens: this.totalTokens }) + '\n');
      } catch { /* silent */ }
    }
  }

  // ── SHIP IT ────────────────────────────────────────────────────────────────────
  private async doShipIt(): Promise<void> {
    if (!this.lastDeliverables) { this.print(`\n  ${c.muted('Nothing to ship.\n')}`); return; }
    const msg = `feat: ${(this.recentIntents.at(-1) ?? 'changes').slice(0, 72)}`;

    spinner.start('Staging all changes…');
    try {
      await this.git.addAll();
    } catch (err: any) {
      spinner.fail(`Stage failed: ${err.message}`);
      return;
    }

    spinner.setText('Committing…');
    try {
      const hash = await this.git.commit(msg);
      if (!hash) {
        spinner.stop();
        this.print(`\n  ${c.muted('Nothing to commit — all clean.\n')}`);
        this.lastSuccess = false;
        return;
      }
      this.commitCount++;
      spinner.succeed(`Committed  ${c.dim(hash.slice(0, 8))}  ${c.muted(`"${msg}"`)}`);
      tray.success(`Committed ${hash.slice(0, 8)}`);

      const hasRemote = await this.git.hasRemote();
      if (hasRemote) {
        spinner.start('Pushing to remote…');
        const pushed = await this.git.push();
        if (pushed) {
          spinner.succeed('Pushed to remote');
          tray.success('Pushed to remote');
        } else {
          spinner.warn('Push failed — commit is local');
          tray.warning('Push failed — commit is local');
        }
      } else {
        this.print(`  ${c.dim('No remote configured — commit is local only.\n')}`);
      }
    } catch (err: any) {
      spinner.fail(`Commit failed: ${err.message}`);
    }
    this.lastSuccess = false;
  }

  // ── Rollback ───────────────────────────────────────────────────────────────────
  private async doRollback(): Promise<void> {
    spinner.start('Stashing…');
    try {
      const log = await this.git.getLog(1);
      spinner.stop();
      if (!log.length) { this.print(`\n  ${c.muted('No commits to roll back.\n')}`); return; }
      this.print(`\n  ${c.warning('⚠')}  Last commit: ${c.dim(log[0].hash)} ${c.muted(log[0].message)}\n`);
      spinner.start('Stashing…');
      const ok = await this.git.stash();
      spinner.stop();
      this.print(ok
        ? `  ${c.success('✓')} Changes stashed.  ${c.dim('/git stash pop')} to restore.\n`
        : errorCard({ title: 'Stash failed', message: 'Could not stash changes.' })
      );
    } catch (err: any) { spinner.stop(); this.print(errorCard({ title: 'Rollback failed', message: err.message })); }
  }

  // ── Diff viewer ──────────────────────────────────────────────────────────────
  private async showDiff(): Promise<void> {
    if (!this.lastDeliverables) {
      const diff = await this.git.getDiff();
      if (!diff) { this.print(`\n  ${c.muted('No changes.\n')}`); return; }
      InteractiveDiffViewer.printDiff(diff);
      return;
    }
    const d = this.lastDeliverables;
    const allDiffs = d.files_modified.map((f: any) => f.diff ?? '').join('\n');
    if (!allDiffs) { this.print(`\n  ${c.muted('No diffs in deliverables.\n')}`); return; }
    this.diffViewer.parse(allDiffs);
    await this.diffViewer.show();
  }

  // ── File browser ────────────────────────────────────────────────────────────
  private async openFileBrowser(): Promise<void> {
    const browser = new FileBrowser(this.cfg.projectDir);
    const result = await browser.show();

    if (result.action === 'open' && result.selected) {
      const fs = await import('node:fs');
      try {
        const content = fs.readFileSync(result.selected, 'utf-8');
        const lines = content.split('\n');
        const rel = result.selected.replace(this.cfg.projectDir, '').replace(/^[/\\]/, '');
        this.print(`\n  ${c.accent(rel)}  ${c.dim(`${lines.length} lines`)}\n`);
        lines.slice(0, 50).forEach((l, i) =>
          this.print(`  ${c.muted(String(i + 1).padStart(4))}  ${l}\n`)
        );
        if (lines.length > 50) this.print(c.dim(`  … ${lines.length - 50} more\n`));
        this.print('\n');
      } catch {
        this.print(`\n  ${c.error('Cannot read:')} ${result.selected}\n`);
      }
    }
  }

  private async pickFile(filter?: string): Promise<void> {
    const selected = await FilePicker.pick(this.cfg.projectDir, filter);
    if (selected) {
      const rel = selected.replace(this.cfg.projectDir, '').replace(/^[/\\]/, '');
      this.print(`\n  ${c.success('✓')} ${c.text(rel)}\n`);
    }
  }

  // ── Command runner ─────────────────────────────────────────────────────────────
  private async runCmd(slash: string): Promise<void> {
    const result = findCommand(slash);
    if (result) await result.command.execute(result.commandArgs ?? result.args, this.cmdCtx());
    else this.print(`\n  ${c.error('Unknown:')} ${slash}  ${c.dim('(try /help)\n')}`);
  }

  private cmdCtx(): CommandContext {
    return {
      session: this.session, costTracker: this.costTracker,
      modelSelector: this.modelSelector, git: this.git, permissions: this.permissions,
      projectDir: this.cfg.projectDir,
      planMode: this.planMode,               setPlanMode: m  => { this.planMode = m; },
      streamOutput: this.streamOutput,       setStreamOutput: o => { this.streamOutput = o; },
      compactAuto: this.compactAuto,         setCompactAuto: o  => { this.compactAuto = o; },
    };
  }

  private print(s: string): void { process.stdout.write(s); }

  private goodbye(): void {
    this.running = false;
    this.editor?.destroy();
    process.stdout.write(ANSI.showCursor);
    this.print(goodbyeCard({
      sessionMs:  Date.now() - this.sessionStart,
      pipelines:  this.pipelineCount,
      tokens:     this.totalTokens,
      commits:    this.commitCount,
      model:      this.modelSelector.getCurrentModel() || undefined,
    }));
  }

  private async refreshGit(): Promise<void> {
    try {
      const info = await this.git.getInfo();
      if (info.isRepo) { this.gitBranch = info.branch; this.gitDirty = !info.isClean; }
    } catch { /* silent */ }
  }
}
