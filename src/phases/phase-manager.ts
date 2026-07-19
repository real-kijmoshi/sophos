import type { PhaseId, PhaseResult, PhaseStatus } from '../types.js';

export type PhaseExecutor = () => Promise<PhaseResult>;

export interface PhaseDefinition {
  id: PhaseId;
  name: string;
  executor: PhaseExecutor;
}

export class PhaseManager {
  private phases: PhaseDefinition[] = [];
  private results: PhaseResult[] = [];
  private currentPhase: PhaseId | null = null;

  register(phase: PhaseDefinition): void {
    this.phases.push(phase);
  }

  async executeAll(signal?: AbortSignal): Promise<PhaseResult[]> {
    this.results = [];

    for (const phase of this.phases) {
      // Honour abort signal between phases
      if (signal?.aborted) {
        this.results.push({
          phase: phase.id,
          status: 'skipped',
          output: null,
          duration_ms: 0,
          errors: ['Aborted'],
        });
        continue;
      }

      this.currentPhase = phase.id;
      const start = Date.now();

      try {
        const result = await phase.executor();
        result.duration_ms = Date.now() - start;
        this.results.push(result);

        if (result.status === 'failed') {
          break;
        }
      } catch (err: any) {
        this.results.push({
          phase: phase.id,
          status: 'failed',
          output: null,
          duration_ms: Date.now() - start,
          errors: [err.message || String(err)],
        });
        break;
      }
    }

    return this.results;
  }

  async executePhase(phaseId: PhaseId): Promise<PhaseResult | null> {
    const phase = this.phases.find(p => p.id === phaseId);
    if (!phase) return null;

    const start = Date.now();
    try {
      const result = await phase.executor();
      result.duration_ms = Date.now() - start;
      this.results.push(result);
      return result;
    } catch (err: any) {
      const result: PhaseResult = {
        phase: phaseId,
        status: 'failed',
        output: null,
        duration_ms: Date.now() - start,
        errors: [err.message || String(err)],
      };
      this.results.push(result);
      return result;
    }
  }

  getResults(): PhaseResult[] {
    return this.results;
  }

  getResult(phaseId: PhaseId): PhaseResult | undefined {
    return this.results.find(r => r.phase === phaseId);
  }

  get allPassed(): boolean {
    return this.results.every(r => r.status === 'passed');
  }

  get lastResult(): PhaseResult | undefined {
    return this.results[this.results.length - 1];
  }
}
