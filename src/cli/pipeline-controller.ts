// ── Interactive Pipeline Keyboard Controller ──────────────────────────────────
// Listens for keypresses during pipeline execution to let users navigate and
// inspect phases in real time. The selection highlight and the key hint are
// rendered by PhaseRenderer inside its live region, so nothing printed here
// can knock the repaint out of alignment.
//
// Controls:
//   ↑/↓  or  j/k   — move phase selection
//   v / Enter      — toggle selected phase expansion
//   a              — expand all phases
//   c              — collapse all phases
//   Esc / Ctrl+C   — interrupt the pipeline

import { phaseRenderer } from './phase-renderer.js';

const PHASE_ORDER = [
  'repository-analysis', 'planning-swarm', 'execution-planning',
  'coding-swarm', 'multi-agent-review', 'automated-validation',
  'security-swarm', 'integration', 'final-qa',
];

export class PipelineKeyboardController {
  private active        = false;
  private selectedIndex = -1;
  private listener: ((str: string, key: any) => void) | null = null;
  private abortCtrl:    AbortController | null = null;

  start(abortCtrl: AbortController): void {
    if (this.active) return;
    this.active = true;
    this.selectedIndex = -1;
    this.abortCtrl = abortCtrl;

    this.listener = (str: string, key: any) => {
      if (!key || !this.active) return;
      this.handleKey(str, key);
    };

    process.stdin.on('keypress', this.listener);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.abortCtrl = null;
    phaseRenderer.setSelected(-1);
    if (this.listener) {
      process.stdin.removeListener('keypress', this.listener);
      this.listener = null;
    }
  }

  private handleKey(_str: string, key: any): void {
    // Esc or Ctrl+C — interrupt the pipeline
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      this.abortCtrl?.abort();
      return;
    }

    // Ignore other ctrl/meta combos
    if (key.ctrl || key.meta) return;

    switch (key.name) {
      case 'up':
      case 'k':
        this.moveSelection(-1);
        break;
      case 'down':
      case 'j':
        this.moveSelection(1);
        break;
      case 'v':
      case 'return':
        this.toggleCurrent();
        break;
      case 'a':
        phaseRenderer.expandAll();
        break;
      case 'c':
        phaseRenderer.collapseAll();
        break;
    }
  }

  private moveSelection(delta: number): void {
    if (this.selectedIndex === -1) {
      // First press lands on the running phase (or the first one)
      const running = PHASE_ORDER.findIndex(id => phaseRenderer.getPhase(id)?.status === 'running');
      this.selectedIndex = running >= 0 ? running : 0;
    } else {
      this.selectedIndex = Math.max(0, Math.min(PHASE_ORDER.length - 1, this.selectedIndex + delta));
    }
    phaseRenderer.setSelected(this.selectedIndex);

    const phase = phaseRenderer.getPhase(PHASE_ORDER[this.selectedIndex]);
    if (phase && phase.collapsed && phase.status !== 'pending') {
      phase.collapsed = false;
      phase.dirty = true;
    }
  }

  private toggleCurrent(): void {
    if (this.selectedIndex === -1) return;
    phaseRenderer.toggleCollapse(PHASE_ORDER[this.selectedIndex]);
  }
}
