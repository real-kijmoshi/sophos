// ── Sophos Batch Formatter v2.0 ───────────────────────────────────────────────
// Enhanced output formatting for batch mode with structured, readable output
// Inspired by modern CLI tools like CodeXZ CLI and Grok Code

import { c, createDivider, createSection, createBadge, createProgressBar } from './modern-ui.js';

// ── Types ────────────────────────────────────────────────────────────────────
export interface BatchPhaseEvent {
  type: 'start' | 'line' | 'done' | 'fail';
  phaseId: string;
  phaseName: string;
  line?: string;
  durationMs?: number;
  error?: string;
}

export interface BatchResult {
  success: boolean;
  deliverables?: {
    executive_summary: string;
    files_created: any[];
    files_modified: any[];
    security_report: any[];
    llm_stats?: {
      calls: number;
      total_tokens: number;
    };
  };
}

export interface BatchOptions {
  targetDir: string;
  request: string;
  planMode: boolean;
  dryRun: boolean;
  verbose: boolean;
  model?: string;
}

// ── Main Batch Formatter ─────────────────────────────────────────────────────
export class BatchFormatter {
  private options: BatchOptions;
  private phaseStartTime: Map<string, number> = new Map();
  private phaseDurations: Map<string, number> = new Map();
  private phaseLines: Map<string, string[]> = new Map();
  private currentPhase: string | null = null;
  private terminalWidth: number;
  
  constructor(options: BatchOptions) {
    this.options = options;
    this.terminalWidth = Math.min(process.stdout.columns || 80, 120);
  }
  
  // ── Header ────────────────────────────────────────────────────────────────
  printHeader(): void {
    const { targetDir, request, planMode, dryRun, model } = this.options;
    
    console.log(createDivider('═', this.terminalWidth));
    console.log(`  ${c.primary.bold('◆ SOPHOS')} ${c.dim('· Batch Mode')}`);
    console.log(createDivider('─', this.terminalWidth));
    
    // Configuration summary
    console.log(`  ${c.dim('Target:')}  ${c.accent(targetDir)}`);
    console.log(`  ${c.dim('Request:')} ${c.text(request)}`);
    
    if (model) {
      console.log(`  ${c.dim('Model:')}   ${c.cyan(model)}`);
    }
    
    const modeBadges: string[] = [];
    if (planMode) modeBadges.push(createBadge('plan only', { color: 'warning' }));
    if (dryRun) modeBadges.push(createBadge('dry run', { color: 'info' }));
    
    if (modeBadges.length > 0) {
      console.log(`  ${c.dim('Mode:')}    ${modeBadges.join(' ')}`);
    }
    
    console.log(createDivider('─', this.terminalWidth));
    console.log('');
  }
  
  // ── Phase Events ──────────────────────────────────────────────────────────
  onPhaseEvent(event: BatchPhaseEvent): void {
    switch (event.type) {
      case 'start':
        this.onPhaseStart(event);
        break;
      case 'line':
        this.onPhaseLine(event);
        break;
      case 'done':
        this.onPhaseDone(event);
        break;
      case 'fail':
        this.onPhaseFail(event);
        break;
    }
  }
  
  private onPhaseStart(event: BatchPhaseEvent): void {
    this.currentPhase = event.phaseId;
    this.phaseStartTime.set(event.phaseId, Date.now());
    this.phaseLines.set(event.phaseId, []);
    
    const phaseNum = this.getPhaseNumber(event.phaseId);
    const phasePrefix = `${c.dim(phaseNum.toString().padStart(2))} ${c.warning('▶')}`;
    
    console.log(`  ${phasePrefix}  ${c.warning.bold(event.phaseName)}`);
    
    if (this.options.verbose) {
      console.log(`  ${c.dim('│')}`);
    }
  }
  
  private onPhaseLine(event: BatchPhaseEvent): void {
    if (!event.line) return;
    
    // Store line for potential summary
    const lines = this.phaseLines.get(event.phaseId) || [];
    lines.push(event.line);
    this.phaseLines.set(event.phaseId, lines);
    
    if (this.options.verbose) {
      // Format line based on content
      const formattedLine = this.formatLine(event.line);
      console.log(`  ${c.dim('│')} ${formattedLine}`);
    }
  }
  
  private onPhaseDone(event: BatchPhaseEvent): void {
    const startTime = this.phaseStartTime.get(event.phaseId);
    const duration = event.durationMs || (startTime ? Date.now() - startTime : 0);
    this.phaseDurations.set(event.phaseId, duration);
    
    const phaseNum = this.getPhaseNumber(event.phaseId);
    const phasePrefix = `${c.dim(phaseNum.toString().padStart(2))} ${c.success('✓')}`;
    const durationStr = c.dim(` ${this.formatDuration(duration)}`);
    
    console.log(`  ${phasePrefix}  ${c.success.bold(event.phaseName)}${durationStr}`);
    
    // Show summary of important lines
    if (!this.options.verbose) {
      const lines = this.phaseLines.get(event.phaseId) || [];
      const importantLines = this.extractImportantLines(lines);
      if (importantLines.length > 0) {
        for (const line of importantLines.slice(0, 3)) {
          console.log(`        ${c.dim('·')} ${this.formatLine(line)}`);
        }
      }
    }
    
    this.currentPhase = null;
  }
  
  private onPhaseFail(event: BatchPhaseEvent): void {
    const startTime = this.phaseStartTime.get(event.phaseId);
    const duration = event.durationMs || (startTime ? Date.now() - startTime : 0);
    
    const phaseNum = this.getPhaseNumber(event.phaseId);
    const phasePrefix = `${c.dim(phaseNum.toString().padStart(2))} ${c.error('✗')}`;
    const durationStr = c.dim(` ${this.formatDuration(duration)}`);
    
    console.log(`  ${phasePrefix}  ${c.error.bold(event.phaseName)}${durationStr}`);
    
    if (event.error) {
      console.log(`        ${c.error('Error:')} ${event.error}`);
    }
    
    // Show last few lines for context
    const lines = this.phaseLines.get(event.phaseId) || [];
    const lastLines = lines.slice(-3);
    if (lastLines.length > 0) {
      console.log(`        ${c.dim('Last output:')}`);
      for (const line of lastLines) {
        console.log(`          ${c.dim('│')} ${this.formatLine(line)}`);
      }
    }
    
    this.currentPhase = null;
  }
  
  // ── Result Display ────────────────────────────────────────────────────────
  printResult(result: BatchResult): void {
    console.log('');
    console.log(createDivider('═', this.terminalWidth));
    
    const statusIcon = result.success ? c.success('✓') : c.error('✗');
    const statusText = result.success ? 
      c.success.bold('PIPELINE COMPLETE') : 
      c.error.bold('PIPELINE FAILED');
    
    console.log(`  ${statusIcon}  ${statusText}`);
    console.log(createDivider('─', this.terminalWidth));
    
    if (result.deliverables) {
      this.printDeliverables(result.deliverables);
    }
    
    // Summary statistics
    this.printStatistics(result);
    
    console.log(createDivider('═', this.terminalWidth));
  }
  
  private printDeliverables(deliverables: any): void {
    const { executive_summary, files_created, files_modified, security_report, llm_stats } = deliverables;
    
    // Executive Summary
    console.log(`  ${c.primary.bold('Summary')}`);
    console.log(`    ${c.text(executive_summary)}`);
    console.log('');
    
    // Files Changed
    console.log(`  ${c.primary.bold('Files')}`);
    if (files_created.length > 0) {
      console.log(`    ${c.success('Created:')}  ${c.accent(files_created.length.toString())}`);
      if (this.options.verbose) {
        for (const file of files_created.slice(0, 5)) {
          console.log(`      ${c.dim('+')} ${c.success(file)}`);
        }
        if (files_created.length > 5) {
          console.log(`      ${c.dim(`... and ${files_created.length - 5} more`)}`);
        }
      }
    }
    
    if (files_modified.length > 0) {
      console.log(`    ${c.info('Modified:')} ${c.accent(files_modified.length.toString())}`);
      if (this.options.verbose) {
        for (const file of files_modified.slice(0, 5)) {
          console.log(`      ${c.dim('~')} ${c.info(file)}`);
        }
        if (files_modified.length > 5) {
          console.log(`      ${c.dim(`... and ${files_modified.length - 5} more`)}`);
        }
      }
    }
    
    if (files_created.length === 0 && files_modified.length === 0) {
      console.log(`    ${c.dim('No files were changed.')}`);
    }
    console.log('');
    
    // Security Findings
    if (security_report.length > 0) {
      console.log(`  ${c.primary.bold('Security')}`);
      console.log(`    ${c.warning('Findings:')} ${c.accent(security_report.length.toString())}`);
      
      // Group by severity
      const critical = security_report.filter((r: any) => r.severity === 'critical');
      const high = security_report.filter((r: any) => r.severity === 'high');
      const medium = security_report.filter((r: any) => r.severity === 'medium');
      const low = security_report.filter((r: any) => r.severity === 'low');
      
      if (critical.length > 0) {
        console.log(`      ${c.error('●')} Critical: ${c.error(critical.length.toString())}`);
      }
      if (high.length > 0) {
        console.log(`      ${c.orange('●')} High:     ${c.orange(high.length.toString())}`);
      }
      if (medium.length > 0) {
        console.log(`      ${c.warning('●')} Medium:   ${c.warning(medium.length.toString())}`);
      }
      if (low.length > 0) {
        console.log(`      ${c.info('●')} Low:      ${c.info(low.length.toString())}`);
      }
      console.log('');
    }
  }
  
  private printStatistics(result: BatchResult): void {
    // Phase statistics
    const phases = Array.from(this.phaseDurations.entries());
    const totalDuration = phases.reduce((sum, [, duration]) => sum + duration, 0);
    const completedPhases = phases.length;
    const totalPhases = 9; // SOPHOS has 9 phases
    
    console.log(`  ${c.primary.bold('Statistics')}`);
    console.log(`    ${c.dim('Phases:')}    ${c.accent(completedPhases.toString())}/${totalPhases}`);
    console.log(`    ${c.dim('Duration:')}  ${c.accent(this.formatDuration(totalDuration))}`);
    
    // LLM statistics if available
    if (result.deliverables?.llm_stats) {
      const { calls, total_tokens } = result.deliverables.llm_stats;
      console.log(`    ${c.dim('LLM Calls:')} ${c.accent(calls.toString())}`);
      console.log(`    ${c.dim('Tokens:')}    ${c.accent(total_tokens.toLocaleString())}`);
    }
    
    // Performance breakdown
    if (phases.length > 0 && this.options.verbose) {
      console.log(`    ${c.dim('Breakdown:')}`);
      for (const [phaseId, duration] of phases.slice(0, 5)) {
        const phaseName = this.getPhaseName(phaseId);
        const percentage = totalDuration > 0 ? Math.round((duration / totalDuration) * 100) : 0;
        console.log(`      ${c.dim('·')} ${phaseName.padEnd(25)} ${c.accent(this.formatDuration(duration))} ${c.dim(`(${percentage}%)`)}`);
      }
      if (phases.length > 5) {
        console.log(`      ${c.dim(`... and ${phases.length - 5} more phases`)}`);
      }
    }
    
    console.log('');
  }
  
  // ── Progress Display ──────────────────────────────────────────────────────
  printProgress(currentPhase: number, totalPhases: number): void {
    const percentage = Math.round((currentPhase / totalPhases) * 100);
    const progressBar = createProgressBar(percentage, '', {
      width: 30,
      showPercentage: true,
      color: 'accent',
    });
    
    console.log(`  ${c.dim('Progress:')} ${progressBar}`);
  }
  
  // ── Error Display ─────────────────────────────────────────────────────────
  printError(error: Error, context?: string): void {
    console.log('');
    console.log(createDivider('═', this.terminalWidth));
    console.log(`  ${c.error.bold('FATAL ERROR')}`);
    console.log(createDivider('─', this.terminalWidth));
    
    if (context) {
      console.log(`  ${c.dim('Context:')} ${c.text(context)}`);
    }
    
    console.log(`  ${c.dim('Error:')} ${c.error(error.message)}`);
    
    if (error.stack && this.options.verbose) {
      console.log(`  ${c.dim('Stack:')}`);
      const stackLines = error.stack.split('\n').slice(0, 5);
      for (const line of stackLines) {
        console.log(`    ${c.dim(line)}`);
      }
    }
    
    console.log(createDivider('═', this.terminalWidth));
  }
  
  printCancellation(): void {
    console.log('');
    console.log(createDivider('═', this.terminalWidth));
    console.log(`  ${c.warning.bold('PIPELINE CANCELLED')}`);
    console.log(createDivider('─', this.terminalWidth));
    
    const completedPhases = this.phaseDurations.size;
    const totalPhases = 9;
    
    console.log(`  ${c.dim('Progress:')} ${c.accent(completedPhases.toString())}/${totalPhases} phases`);
    
    // Show what was completed
    if (completedPhases > 0) {
      console.log(`  ${c.dim('Completed:')}`);
      for (const [phaseId] of Array.from(this.phaseDurations.entries()).slice(0, 3)) {
        const phaseName = this.getPhaseName(phaseId);
        console.log(`    ${c.dim('·')} ${c.success(phaseName)}`);
      }
      if (completedPhases > 3) {
        console.log(`    ${c.dim(`... and ${completedPhases - 3} more`)}`);
      }
    }
    
    console.log('');
    console.log(`  ${c.dim('Note:')} Partial results may have been written to disk.`);
    console.log(`        Use ${c.primary('--verbose')} for detailed output.`);
    console.log(createDivider('═', this.terminalWidth));
  }
  
  // ── Utility Methods ───────────────────────────────────────────────────────
  private getPhaseNumber(phaseId: string): number {
    const index = [
      'repository-analysis', 'planning-swarm', 'execution-planning',
      'coding-swarm', 'multi-agent-review', 'automated-validation',
      'security-swarm', 'integration', 'final-qa'
    ].indexOf(phaseId);
    return index + 1; // 1-based numbering
  }
  
  private getPhaseName(phaseId: string): string {
    const names: Record<string, string> = {
      'repository-analysis': 'Repository Analysis',
      'planning-swarm': 'Planning Swarm',
      'execution-planning': 'Execution Planning',
      'coding-swarm': 'Coding Swarm',
      'multi-agent-review': 'Multi-Agent Review',
      'automated-validation': 'Automated Validation',
      'security-swarm': 'Security Swarm',
      'integration': 'Integration',
      'final-qa': 'Final QA',
    };
    return names[phaseId] || phaseId;
  }
  
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  
  private formatLine(line: string): string {
    // Color code based on content
    const lowerLine = line.toLowerCase();
    
    if (/error|failed|fatal|exception/i.test(line)) {
      return c.error(line);
    }
    if (/warning|warn|caution/i.test(line)) {
      return c.warning(line);
    }
    if (/success|passed|completed|done|✓/i.test(line)) {
      return c.success(line);
    }
    if (/info|note|hint|tip/i.test(line)) {
      return c.info(line);
    }
    if (/creating|adding|writing|generating/i.test(line)) {
      return c.accent(line);
    }
    if (/checking|verifying|validating|testing/i.test(line)) {
      return c.cyan(line);
    }
    
    // JSON or code blocks
    if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
      return c.purple(line);
    }
    
    // File paths
    if (line.includes('/') || line.includes('\\') || line.includes('.')) {
      return c.text(line);
    }
    
    return c.muted(line);
  }
  
  private extractImportantLines(lines: string[]): string[] {
    return lines.filter(line => {
      const lower = line.toLowerCase();
      return (
        /error|warning|success|failed|completed|created|modified|security|vulnerability|critical|high|medium|low/i.test(lower) ||
        line.includes('✓') || line.includes('✗') || line.includes('⚠')
      );
    });
  }
  
  // ── Public API ────────────────────────────────────────────────────────────
  static format(options: BatchOptions): BatchFormatter {
    return new BatchFormatter(options);
  }
}