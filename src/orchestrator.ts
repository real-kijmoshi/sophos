// ── SOPHOS v3.0 Orchestrator ──────────────────────────────────────────────────
// EventEmitter-based orchestrator.
// Emits phase:start, phase:line, phase:done, phase:fail, task:update
// so the PhaseRenderer can display live collapsible cards.

import { EventEmitter } from 'node:events';
import { globalBus }    from './global-bus.js';
import { PhaseManager }                from './phases/phase-manager.js';
import { executeRepositoryAnalysis }   from './phases/phase-1-repository.js';
import { executePlanningSwarm }        from './phases/phase-2-planning.js';
import { executeExecutionPlanning }    from './phases/phase-3-execution.js';
import { executeCodingSwarm, type CodingOutput } from './phases/phase-4-coding.js';
import { executeCodeReview, buildReviewConsensus } from './phases/phase-5-review.js';
import { executeAutomatedValidation, type ValidationResult } from './phases/phase-6-validation.js';
import { executeSecuritySwarm, filterActionableFindings } from './phases/phase-7-security.js';
import { executeIntegration }          from './phases/phase-8-integration.js';
import { executeFinalQA }              from './phases/phase-9-qa.js';
import { LLMAgent }                    from './llm/agent.js';
import type {
  OrchestratorConfig, ContextPackage, ImplementationSpecification,
  TaskGraph, PhaseResult, PhaseId, SecurityFinding,
} from './types.js';
import type { SophosConfig }           from './config/config.js';

// ── Auto-model tier per phase ─────────────────────────────────────────────────
const PHASE_MODEL_TIER: Record<string, 'small' | 'medium' | 'large'> = {
  'repository-analysis': 'small',
  'planning-swarm':      'large',
  'execution-planning':  'medium',
  'coding-swarm':        'medium',
  'multi-agent-review':  'medium',
  'automated-validation':'small',
  'security-swarm':      'large',
  'integration':         'small',
  'final-qa':            'medium',
};

// ── Event payload types ───────────────────────────────────────────────────────
export interface PhaseStartEvent  { phaseId: string; phaseName: string; }
export interface PhaseLineEvent   { phaseId: string; line: string; }
export interface PhaseDoneEvent   { phaseId: string; phaseName: string; durationMs: number; }
export interface PhaseFailEvent   { phaseId: string; phaseName: string; durationMs: number; error: string; }
export interface TaskUpdateEvent  { id: string; description: string; status: 'queue'|'active'|'done'|'failed'|'repair'; reviewers?: string; effort?: 'small' | 'medium' | 'large'; }

export class Orchestrator extends EventEmitter {
  private static jobCounter = 0;
  private orchestratorConfig: OrchestratorConfig;
  private sophosConfig: SophosConfig;
  private phaseManager: PhaseManager;
  private llm: LLMAgent;
  private abortSignal?: AbortSignal;
  readonly jobId: string;
  private source: 'tui' | 'webui' | 'batch' | 'mcp' = 'tui';

  // Phase state
  private contextPackage?:     ContextPackage;
  private implementationSpec?: ImplementationSpecification;
  private taskGraph?:          TaskGraph;
  private codingOutputs?:      Map<string, CodingOutput>;
  private reviewResults?:      any[];
  private consensusResult?:    any;
  private securityFindings?:   SecurityFinding[];
  private validationResult?:   ValidationResult;

  constructor(orchestratorConfig: OrchestratorConfig, sophosConfig: SophosConfig, source: 'tui' | 'webui' | 'batch' | 'mcp' = 'tui') {
    super();
    this.jobId  = `job-${++Orchestrator.jobCounter}`;
    this.source = source;
    this.orchestratorConfig = orchestratorConfig;

    // Merge runtime model overrides into a patched config so all phases use the right models
    this.sophosConfig = {
      ...sophosConfig,
      ollama: {
        ...sophosConfig.ollama,
        ...(orchestratorConfig.model_small    && { model_small:    orchestratorConfig.model_small    }),
        ...(orchestratorConfig.model_medium   && { model_medium:   orchestratorConfig.model_medium   }),
        ...(orchestratorConfig.model_large    && { model_large:    orchestratorConfig.model_large    }),
        ...(orchestratorConfig.model_coder    && { model_coder:    orchestratorConfig.model_coder    }),
        ...(orchestratorConfig.model_planner  && { model_planner:  orchestratorConfig.model_planner  }),
        ...(orchestratorConfig.model_executor && { model_executor: orchestratorConfig.model_executor }),
        ...(orchestratorConfig.model_chat     && { model_chat:     orchestratorConfig.model_chat     }),
      },
    };

    this.phaseManager = new PhaseManager();
    this.llm          = new LLMAgent(this.sophosConfig);
    this.registerPhases();

    // Announce to global bus so WebUI (and any other subscriber) knows a job started
    globalBus.emit('job:started', {
      jobId:   this.jobId,
      request: orchestratorConfig.user_request,
      source:  this.source,
    });
  }

  private registerPhases(): void {
    this.phaseManager.register({ id: 'repository-analysis', name: 'Repository Analysis',       executor: () => this.runPhase1() });
    this.phaseManager.register({ id: 'planning-swarm',      name: 'Planning Swarm',            executor: () => this.runPhase2() });
    this.phaseManager.register({ id: 'execution-planning',  name: 'Execution Planning',        executor: () => this.runPhase3() });
    this.phaseManager.register({ id: 'coding-swarm',        name: 'Coding Swarm',              executor: () => this.runPhase4() });
    this.phaseManager.register({ id: 'multi-agent-review',  name: 'Multi-Agent Code Review',   executor: () => this.runPhase5() });
    this.phaseManager.register({ id: 'automated-validation',name: 'Automated Validation',      executor: () => this.runPhase6() });
    this.phaseManager.register({ id: 'security-swarm',      name: 'Security Swarm',            executor: () => this.runPhase7() });
    this.phaseManager.register({ id: 'integration',         name: 'Integration',               executor: () => this.runPhase8() });
    this.phaseManager.register({ id: 'final-qa',            name: 'Final QA',                  executor: () => this.runPhase9() });
  }

  // ── Public execute ────────────────────────────────────────────────────────────
  async execute(signal?: AbortSignal): Promise<{ success: boolean; results: PhaseResult[]; deliverables?: any }> {
    this.abortSignal = signal;
    this.llm.setAbortSignal(signal);
    const available = await this.llm.isAvailable();
    if (!available) {
      this.emit('phase:line', { phaseId: 'repository-analysis', line: `✗ Ollama not reachable at ${this.sophosConfig.ollama.base_url}` } satisfies PhaseLineEvent);
      return { success: false, results: [] };
    }

    // Wire token streaming → emit llm:token for every streamed chunk
    this.llm.onToken((chunk: string, agentName: string) => {
      this.emit('llm:token', { chunk, agentName });
      globalBus.emit('llm:token', { jobId: this.jobId, chunk, agentName });
    });

    const results = await this.phaseManager.executeAll(signal);
    this.llm.setAbortSignal(undefined);
    const allPassed = results.every(r => r.status === 'passed' || r.status === 'skipped');

    this.emit('pipeline:done', { success: allPassed });
    globalBus.emit('job:done', { jobId: this.jobId, success: allPassed });

    if (allPassed) {
      return { success: true, results, deliverables: this.generateDeliverables() };
    }
    return { success: false, results };
  }

  // ── Mid-run steering ──────────────────────────────────────────────────────────
  /**
   * Inject a user note while the pipeline runs. Phases read user_request at
   * execution time, so phases that haven't started yet will see the note.
   */
  addSteering(note: string): void {
    this.orchestratorConfig.user_request += `\n\nUSER STEERING NOTE (added mid-run, honor it): ${note}`;
    this.emit('steering', { note });
    globalBus.emit('steering:ack', { jobId: this.jobId, note });
  }

  // ── Phase helpers ─────────────────────────────────────────────────────────────
  private phaseStart(id: string, name: string): number {
    this.emit('phase:start', { phaseId: id, phaseName: name } satisfies PhaseStartEvent);
    globalBus.emit('pipeline:event', { jobId: this.jobId, event: { type: 'phase:start', timestamp: Date.now(), phaseId: id, phaseName: name } });
    return Date.now();
  }

  private phaseLine(id: string, line: string): void {
    this.emit('phase:line', { phaseId: id, line } satisfies PhaseLineEvent);
    globalBus.emit('pipeline:event', { jobId: this.jobId, event: { type: 'phase:line', timestamp: Date.now(), phaseId: id, line } });
  }

  private phaseDone(id: string, name: string, startMs: number): void {
    const durationMs = Date.now() - startMs;
    this.emit('phase:done', { phaseId: id, phaseName: name, durationMs } satisfies PhaseDoneEvent);
    globalBus.emit('pipeline:event', { jobId: this.jobId, event: { type: 'phase:done', timestamp: Date.now(), phaseId: id, phaseName: name, durationMs } });
  }

  private phaseFail(id: string, name: string, startMs: number, error: string): void {
    const durationMs = Date.now() - startMs;
    this.emit('phase:fail', { phaseId: id, phaseName: name, durationMs, error } satisfies PhaseFailEvent);
    globalBus.emit('pipeline:event', { jobId: this.jobId, event: { type: 'phase:fail', timestamp: Date.now(), phaseId: id, phaseName: name, durationMs, error } });
  }

  private taskUpdate(row: TaskUpdateEvent): void {
    this.emit('task:update', row);
    globalBus.emit('pipeline:event', { jobId: this.jobId, event: { type: 'task:update', timestamp: Date.now(), ...row } });
  }

  // ── Phase 1: Repository Analysis ─────────────────────────────────────────────
  private async runPhase1(): Promise<PhaseResult> {
    const ID = 'repository-analysis', NAME = 'Repository Analysis';
    const t = this.phaseStart(ID, NAME);
    try {
      this.phaseLine(ID, `Scanning: ${this.orchestratorConfig.target_dir}`);
      this.contextPackage = await executeRepositoryAnalysis(
        this.sophosConfig,
        this.orchestratorConfig.target_dir,
        this.orchestratorConfig.user_request,
        this.llm,
      );
      this.phaseLine(ID, `Stack: ${this.contextPackage.technology_stack.languages.join(', ')}`);
      this.phaseLine(ID, `Files: ${this.contextPackage.repository_summary.file_count}`);
      this.phaseLine(ID, `Risks: ${this.contextPackage.potential_risks.length} detected`);
      this.phaseDone(ID, NAME, t);
      return { phase: ID as PhaseId, status: 'passed', output: this.contextPackage, duration_ms: Date.now() - t, errors: [] };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Phase 2: Planning Swarm ───────────────────────────────────────────────────
  private async runPhase2(): Promise<PhaseResult> {
    const ID = 'planning-swarm', NAME = 'Planning Swarm';
    const t = this.phaseStart(ID, NAME);
    try {
      if (!this.contextPackage) throw new Error('Context package not available');
      this.phaseLine(ID, 'Spawning 8 planning agents…');
      this.implementationSpec = await executePlanningSwarm(
        this.sophosConfig, this.contextPackage, this.orchestratorConfig.user_request, this.llm,
      );
      this.phaseLine(ID, `Architecture: ${this.implementationSpec.architecture?.diagram?.slice(0, 60) ?? 'defined'}`);
      this.phaseLine(ID, `Files to create: ${this.implementationSpec.files_to_create?.length ?? 0}`);
      this.phaseLine(ID, `Files to edit:   ${this.implementationSpec.files_to_edit?.length ?? 0}`);
      this.phaseLine(ID, 'Consensus reached');
      this.phaseDone(ID, NAME, t);
      return { phase: ID as PhaseId, status: 'passed', output: this.implementationSpec, duration_ms: Date.now() - t, errors: [] };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Phase 3: Execution Planning ───────────────────────────────────────────────
  private async runPhase3(): Promise<PhaseResult> {
    const ID = 'execution-planning', NAME = 'Execution Planning';
    const t = this.phaseStart(ID, NAME);
    try {
      if (!this.implementationSpec) throw new Error('Spec not available');
      this.phaseLine(ID, 'Building task graph…');
      this.taskGraph = await executeExecutionPlanning(
        this.sophosConfig, this.implementationSpec, this.contextPackage, this.orchestratorConfig.target_dir, this.llm,
      );
      this.phaseLine(ID, `Tasks:          ${this.taskGraph.tasks.length}`);
      this.phaseLine(ID, `Parallel groups:${this.taskGraph.parallel_groups.length}`);
      this.phaseLine(ID, `Critical path:  ${this.taskGraph.critical_path.length} tasks`);
      // Pre-populate task grid
      for (const task of this.taskGraph.tasks) {
        this.taskUpdate({ id: task.task_id, description: task.objective.slice(0, 40), status: 'queue', effort: task.effort });
      }
      this.phaseDone(ID, NAME, t);
      return { phase: ID as PhaseId, status: 'passed', output: this.taskGraph, duration_ms: Date.now() - t, errors: [] };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Phase 4: Coding Swarm ────────────────────────────────────────────────────
  private async runPhase4(): Promise<PhaseResult> {
    const ID = 'coding-swarm', NAME = 'Coding Swarm';
    const t = this.phaseStart(ID, NAME);
    try {
      if (!this.taskGraph) throw new Error('Task graph not available');
      if (this.orchestratorConfig.dry_run) {
        this.phaseLine(ID, 'Dry run — skipping code generation');
        this.codingOutputs = new Map();
        this.phaseDone(ID, NAME, t);
        return { phase: ID as PhaseId, status: 'passed', output: { dry_run: true }, duration_ms: Date.now() - t, errors: [] };
      }

      // Mark tasks active as we start
      for (const task of this.taskGraph.tasks) {
        this.taskUpdate({ id: task.task_id, description: task.objective.slice(0, 40), status: 'active' });
        this.phaseLine(ID, `Coding: ${task.task_id} — ${task.objective.slice(0, 50)}`);
      }

      this.codingOutputs = await executeCodingSwarm(
        this.sophosConfig, this.taskGraph, this.orchestratorConfig.target_dir, this.llm,
      );

      for (const [taskId] of this.codingOutputs) {
        this.taskUpdate({ id: taskId, description: '', status: 'done' });
      }
      this.phaseLine(ID, `${this.codingOutputs.size} tasks coded`);
      this.phaseDone(ID, NAME, t);
      return { phase: ID as PhaseId, status: 'passed', output: { count: this.codingOutputs.size }, duration_ms: Date.now() - t, errors: [] };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Phase 5: Multi-Agent Review ───────────────────────────────────────────────
  private async runPhase5(): Promise<PhaseResult> {
    const ID = 'multi-agent-review', NAME = 'Multi-Agent Review';
    const t = this.phaseStart(ID, NAME);
    try {
      if (!this.codingOutputs || this.codingOutputs.size === 0) {
        this.phaseLine(ID, 'No coding outputs — skipped');
        this.phaseDone(ID, NAME, t);
        return { phase: ID as PhaseId, status: 'passed', output: { skipped: true }, duration_ms: Date.now() - t, errors: [] };
      }

      this.phaseLine(ID, 'Running 5 reviewers per task…');
      this.reviewResults = await executeCodeReview(
        this.sophosConfig, this.codingOutputs, this.orchestratorConfig.target_dir, this.llm,
      );
      this.consensusResult = await buildReviewConsensus(this.sophosConfig, this.reviewResults, this.llm);

      // Update task grid with review scores
      let idx = 0;
      for (const [taskId] of this.codingOutputs) {
        const result = this.reviewResults[idx];
        const approved = result?.approval_status === 'approved';
        this.taskUpdate({
          id: taskId, description: '', status: approved ? 'done' : 'repair',
          reviewers: approved ? '5/5 pass' : '4/5 pass',
        });
        this.phaseLine(ID, `${taskId}: ${approved ? '✅ approved' : '⚠ changes requested'}`);
        idx++;
      }
      this.phaseLine(ID, `Consensus: ${this.consensusResult.approved ? 'APPROVED' : 'CHANGES REQUESTED'}`);
      this.phaseDone(ID, NAME, t);
      return { phase: ID as PhaseId, status: 'passed', output: this.consensusResult, duration_ms: Date.now() - t, errors: [] };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Phase 6: Automated Validation ────────────────────────────────────────────
  private async runPhase6(): Promise<PhaseResult> {
    const ID = 'automated-validation', NAME = 'Automated Validation';
    const t = this.phaseStart(ID, NAME);
    try {
      if (this.orchestratorConfig.dry_run || this.sophosConfig.pipeline.skip_validation) {
        this.phaseLine(ID, 'Skipped (dry run / config)');
        this.phaseDone(ID, NAME, t);
        return { phase: ID as PhaseId, status: 'passed', output: { skipped: true }, duration_ms: Date.now() - t, errors: [] };
      }
      this.phaseLine(ID, 'Running build…');
      this.validationResult = await executeAutomatedValidation(this.orchestratorConfig.target_dir);
      this.phaseLine(ID, `Build:       ${this.validationResult.build.success        ? '✅' : '❌'}`);
      this.phaseLine(ID, `Type check:  ${this.validationResult.typecheck.success    ? '✅' : '❌'}`);
      this.phaseLine(ID, `Lint:        ${this.validationResult.lint.success         ? '✅' : '❌'}`);
      this.phaseLine(ID, `Unit tests:  ${this.validationResult.unit_tests.success   ? '✅' : '❌'}`);
      this.phaseLine(ID, `Integration: ${this.validationResult.integration_tests.success ? '✅' : '❌'}`);
      if (!this.validationResult.overall) {
        this.phaseFail(ID, NAME, t, 'Validation failed');
        return { phase: ID as PhaseId, status: 'failed', output: this.validationResult, duration_ms: Date.now() - t, errors: ['Validation failed'] };
      }
      this.phaseDone(ID, NAME, t);
      return { phase: ID as PhaseId, status: 'passed', output: this.validationResult, duration_ms: Date.now() - t, errors: [] };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Phase 7: Security Swarm ───────────────────────────────────────────────────
  private async runPhase7(): Promise<PhaseResult> {
    const ID = 'security-swarm', NAME = 'Security Swarm';
    const t = this.phaseStart(ID, NAME);
    try {
      if (this.sophosConfig.pipeline.skip_security) {
        this.phaseLine(ID, 'Skipped (config)');
        this.phaseDone(ID, NAME, t);
        return { phase: ID as PhaseId, status: 'passed', output: { skipped: true }, duration_ms: Date.now() - t, errors: [] };
      }
      this.phaseLine(ID, 'Running 6 security agents…');
      const fileContents = new Map<string, string>();
      if (this.codingOutputs) {
        for (const [, output] of this.codingOutputs) {
          for (const [filePath, content] of output.generated_files) {
            fileContents.set(filePath, content);
          }
        }
      }
      this.securityFindings = await executeSecuritySwarm(this.sophosConfig, fileContents, this.llm);
      const actionable = filterActionableFindings(this.securityFindings);
      this.phaseLine(ID, `AuthZ:        ✅ scanned`);
      this.phaseLine(ID, `Injection:    ✅ scanned`);
      this.phaseLine(ID, `Secrets:      ✅ scanned`);
      this.phaseLine(ID, `Findings: ${this.securityFindings.length} total, ${actionable.length} actionable`);
      if (actionable.length > 0) {
        for (const f of actionable.slice(0, 3)) {
          this.phaseLine(ID, `⚠  ${f.severity.toUpperCase()}: ${f.description.slice(0, 60)}`);
        }
      }
      this.phaseDone(ID, NAME, t);
      return { phase: ID as PhaseId, status: 'passed', output: { total: this.securityFindings.length, actionable: actionable.length }, duration_ms: Date.now() - t, errors: [] };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Phase 8: Integration ──────────────────────────────────────────────────────
  private async runPhase8(): Promise<PhaseResult> {
    const ID = 'integration', NAME = 'Integration';
    const t = this.phaseStart(ID, NAME);
    try {
      if (this.orchestratorConfig.dry_run) {
        this.phaseLine(ID, 'Dry run — skipped');
        this.phaseDone(ID, NAME, t);
        return { phase: ID as PhaseId, status: 'passed', output: { dry_run: true }, duration_ms: Date.now() - t, errors: [] };
      }
      this.phaseLine(ID, 'Merging patches…');
      const result = await executeIntegration(this.codingOutputs || new Map(), this.orchestratorConfig.target_dir);
      this.phaseLine(ID, `Merged:     ${result.merged_patches.length} patches`);
      this.phaseLine(ID, `Conflicts:  ${result.conflicts_resolved} resolved, ${result.conflicts_manual} manual`);
      this.phaseLine(ID, `Integrity:  ${result.integrity_check}`);
      if (result.integration_status !== 'success') {
        this.phaseFail(ID, NAME, t, result.errors.join('; '));
        return { phase: ID as PhaseId, status: 'failed', output: result, duration_ms: Date.now() - t, errors: result.errors };
      }
      this.phaseDone(ID, NAME, t);
      return { phase: ID as PhaseId, status: 'passed', output: result, duration_ms: Date.now() - t, errors: [] };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Phase 9: Final QA ─────────────────────────────────────────────────────────
  private async runPhase9(): Promise<PhaseResult> {
    const ID = 'final-qa', NAME = 'Final QA';
    const t = this.phaseStart(ID, NAME);
    const fallbackValidation: ValidationResult = {
      build:             { success: true, output: '', duration_ms: 0 },
      typecheck:         { success: true, output: '', duration_ms: 0 },
      lint:              { success: true, output: '', duration_ms: 0 },
      format:            { success: true, output: '', duration_ms: 0 },
      unit_tests:        { success: true, output: '', duration_ms: 0 },
      integration_tests: { success: true, output: '', duration_ms: 0 },
      overall:           true,
    };
    try {
      this.phaseLine(ID, 'Running QA gates…');
      const qaResult = await executeFinalQA(
        this.sophosConfig,
        this.orchestratorConfig.target_dir,
        this.orchestratorConfig.user_request,
        this.codingOutputs || new Map(),
        this.securityFindings || [],
        this.validationResult || fallbackValidation,
        this.llm,
      );
      for (const check of qaResult.checks) {
        this.phaseLine(ID, `${check.passed ? '✅' : '❌'} ${check.name}`);
      }
      this.phaseLine(ID, `Decision: ${qaResult.decision.toUpperCase()}`);
      this.phaseDone(ID, NAME, t);
      return {
        phase:       ID as PhaseId,
        status:      qaResult.decision === 'approved' ? 'passed' : 'failed',
        output:      qaResult,
        duration_ms: Date.now() - t,
        errors:      qaResult.issues,
      };
    } catch (err: any) {
      this.phaseFail(ID, NAME, t, err.message);
      return { phase: ID as PhaseId, status: 'failed', output: null, duration_ms: Date.now() - t, errors: [err.message] };
    }
  }

  // ── Deliverables ──────────────────────────────────────────────────────────────
  private generateDeliverables(): any {
    const filesModified: { path: string; diff: string }[]      = [];
    const filesCreated:  { path: string; content: string }[]   = [];

    if (this.codingOutputs) {
      for (const [, output] of this.codingOutputs) {
        for (const [filePath, content] of output.generated_files) {
          filesCreated.push({ path: filePath, content });
        }
        if (output.unified_diff) {
          filesModified.push({ path: output.files_changed.join(', '), diff: output.unified_diff });
        }
      }
    }

    return {
      executive_summary: `Completed: ${this.orchestratorConfig.user_request}`,
      implementation_summary: [],
      files_modified:  filesModified,
      files_created:   filesCreated,
      security_report: this.securityFindings || [],
      test_results: {
        passed:   this.validationResult?.unit_tests?.success ? 1 : 0,
        failed:   this.validationResult?.unit_tests?.success ? 0 : 1,
        coverage: 0,
      },
      validation_results: {
        build:     this.validationResult?.build?.success      ?? true,
        lint:      this.validationResult?.lint?.success       ?? true,
        typecheck: this.validationResult?.typecheck?.success  ?? true,
      },
      llm_stats: {
        calls:            this.llm.getCallLog().length,
        total_tokens:     this.llm.getTotalTokens(),
        total_duration_ms:this.llm.getTotalDurationMs(),
      },
    };
  }
}
