// ── Model Selector v3.0 ───────────────────────────────────────────────────────
// Handles discovery, setup wizard, download suggestions, and runtime overrides.
// Supports project-local (.sophos.json) and global (~/.config/sophos/config.json) config.

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { OllamaClient }    from '../llm/client.js';
import { loadConfig, saveLocalConfig, saveGlobalConfig, getGlobalConfigPath, getDefaultConfigPath } from '../config/config.js';
import { c, formatNumber } from './ui.js';

// ── Curated model catalogue ───────────────────────────────────────────────────
// Source: ollama.com/library — models known to work well with SOPHOS.
export interface ModelSpec {
  name:        string;   // ollama pull name
  label:       string;   // display name
  tier:        'small' | 'medium' | 'large';
  size_gb:     number;
  vram_gb:     number;   // min VRAM (0 = CPU-capable)
  context_k:   number;   // context window in K tokens
  strengths:   string[];
  description: string;
}

export const RECOMMENDED_MODELS: ModelSpec[] = [
  // ── Small ──────────────────────────────────────────────────────────────────
  {
    name: 'qwen2.5-coder:1.5b', label: 'Qwen 2.5 Coder 1.5B', tier: 'small',
    size_gb: 1.0, vram_gb: 0, context_k: 32,
    strengths: ['fast', 'analysis', 'cpu-friendly'],
    description: 'Ultra-fast repo analysis. Runs on CPU, no VRAM needed.',
  },
  {
    name: 'deepseek-coder:1.3b', label: 'DeepSeek Coder 1.3B', tier: 'small',
    size_gb: 0.8, vram_gb: 0, context_k: 16,
    strengths: ['fast', 'analysis'],
    description: 'Tiny coder model, good for quick scans.',
  },
  {
    name: 'codellama:7b', label: 'Code Llama 7B', tier: 'small',
    size_gb: 3.8, vram_gb: 6, context_k: 16,
    strengths: ['coding', 'well-tested'],
    description: 'Meta\'s coding model. Solid baseline for small tier.',
  },
  // ── Medium ─────────────────────────────────────────────────────────────────
  {
    name: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B', tier: 'medium',
    size_gb: 4.7, vram_gb: 8, context_k: 128,
    strengths: ['coding', 'review', '128k context'],
    description: 'Best medium-tier coder. 128k context for large codebases.',
  },
  {
    name: 'deepseek-coder-v2:16b', label: 'DeepSeek Coder V2 16B', tier: 'medium',
    size_gb: 9.1, vram_gb: 12, context_k: 128,
    strengths: ['coding', 'review', 'strong reasoning'],
    description: 'Excellent all-rounder for code generation and review.',
  },
  {
    name: 'codellama:13b', label: 'Code Llama 13B', tier: 'medium',
    size_gb: 7.4, vram_gb: 10, context_k: 16,
    strengths: ['coding', 'well-tested'],
    description: 'Reliable 13B coder. Good if VRAM is limited.',
  },
  {
    name: 'mistral:7b', label: 'Mistral 7B', tier: 'medium',
    size_gb: 4.1, vram_gb: 6, context_k: 32,
    strengths: ['general', 'fast', 'instruction-following'],
    description: 'Fast and capable general model. Works well for planning.',
  },
  // ── Large ──────────────────────────────────────────────────────────────────
  {
    name: 'qwen2.5-coder:32b', label: 'Qwen 2.5 Coder 32B', tier: 'large',
    size_gb: 19.0, vram_gb: 24, context_k: 128,
    strengths: ['planning', 'security', 'complex reasoning', '128k context'],
    description: 'Top-tier open-source coder. Best for planning + security swarms.',
  },
  {
    name: 'deepseek-coder-v2:236b', label: 'DeepSeek Coder V2 236B', tier: 'large',
    size_gb: 130, vram_gb: 80, context_k: 128,
    strengths: ['planning', 'security', 'SOTA'],
    description: 'State-of-the-art open coder. Requires serious hardware.',
  },
  {
    name: 'codellama:34b', label: 'Code Llama 34B', tier: 'large',
    size_gb: 19.0, vram_gb: 24, context_k: 16,
    strengths: ['planning', 'security'],
    description: 'Meta\'s largest code model. Good balance of size and capability.',
  },
  {
    name: 'llama3.1:70b', label: 'Llama 3.1 70B', tier: 'large',
    size_gb: 40.0, vram_gb: 48, context_k: 128,
    strengths: ['planning', 'general', 'long context'],
    description: 'Meta\'s flagship. Excellent for planning and reasoning.',
  },
];

// ── Starter packs ─────────────────────────────────────────────────────────────
export interface StarterPack {
  id:          string;
  label:       string;
  description: string;
  vram_min_gb: number;
  small:       string;
  medium:      string;
  large:       string;
}

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'minimal', label: '🪶  Minimal  (CPU only)',
    description: 'No GPU required. Slower but runs anywhere.',
    vram_min_gb: 0,
    small:  'qwen2.5-coder:1.5b',
    medium: 'deepseek-coder:1.3b',
    large:  'codellama:7b',
  },
  {
    id: 'balanced', label: '⚖️  Balanced  (8–12 GB VRAM)',
    description: 'Best quality/speed ratio for mid-range GPUs.',
    vram_min_gb: 8,
    small:  'qwen2.5-coder:1.5b',
    medium: 'qwen2.5-coder:7b',
    large:  'codellama:13b',
  },
  {
    id: 'performance', label: '🚀  Performance  (24 GB VRAM)',
    description: 'Full pipeline quality. Recommended for serious use.',
    vram_min_gb: 24,
    small:  'qwen2.5-coder:1.5b',
    medium: 'deepseek-coder-v2:16b',
    large:  'qwen2.5-coder:32b',
  },
  {
    id: 'flagship', label: '💎  Flagship  (48 GB+ VRAM)',
    description: 'Best available models. No compromises.',
    vram_min_gb: 48,
    small:  'qwen2.5-coder:1.5b',
    medium: 'qwen2.5-coder:7b',
    large:  'llama3.1:70b',
  },
];

// ── ModelSelector ─────────────────────────────────────────────────────────────
export class ModelSelector {
  private currentModel: string;
  private smallModel:    string;
  private largeModel:    string;
  private coderModel:    string;
  private plannerModel:  string;
  private executorModel: string;
  private chatModel:     string;
  private models:        string[] = [];
  private client:        OllamaClient;
  private ollamaOnline   = false;

  constructor(initialMedium?: string) {
    const config      = loadConfig();
    this.client       = new OllamaClient(config);
    this.currentModel = initialMedium || config.ollama.model_medium || '';
    this.smallModel   = config.ollama.model_small    || '';
    this.largeModel   = config.ollama.model_large    || '';
    this.coderModel   = config.ollama.model_coder    || '';
    this.plannerModel = config.ollama.model_planner  || '';
    this.executorModel = config.ollama.model_executor || '';
    this.chatModel    = config.ollama.model_chat     || '';
  }

  // ── Discovery ──────────────────────────────────────────────────────────────
  async discover(): Promise<string[]> {
    try {
      this.ollamaOnline = await this.client.isAvailable();
      if (!this.ollamaOnline) {
        this.models = [];
        return [];
      }
      this.models = await this.client.listModels();

      // Auto-assign tiers if config has empty models
      if (!this.currentModel) this.currentModel = this.bestForTier('medium');
      if (!this.smallModel)   this.smallModel   = this.bestForTier('small');
      if (!this.largeModel)   this.largeModel   = this.bestForTier('large');

      return this.models;
    } catch {
      this.ollamaOnline = false;
      this.models = [];
      return [];
    }
  }

  // ── Setup wizard ───────────────────────────────────────────────────────────
  /**
   * Interactive first-run wizard.
   * Prints to stdout, reads from stdin.
   * Returns true if the user completed setup.
   */
  async runSetupWizard(scope: 'local' | 'global' = 'local'): Promise<boolean> {
    const w = Math.min(process.stdout.columns || 80, 96);
    const line = c.dim('─'.repeat(w));

    console.log('\n' + line);
    console.log(`  ${c.accent.bold('SOPHOS Model Setup')}`);
    console.log(`  ${c.muted('No models configured. Let\'s pick some.')}`);
    console.log(line);

    if (!this.ollamaOnline) {
      this.printOllamaOffline();
      return false;
    }

    if (this.models.length > 0) {
      // Ollama has models — auto-assign and show what was picked
      return this.autoAssignFromInstalled();
    }

    // Ollama online but no models pulled — show download guide
    this.printDownloadGuide();
    return false;
  }

  /**
   * Show the model status panel (used by /models with no args).
   * If unconfigured, shows the setup guide inline.
   */
  formatModelList(): string {
    const lines: string[] = ['\n'];

    if (!this.ollamaOnline) {
      lines.push(`  ${c.error('●')} ${c.error.bold('Ollama is not running')}`);
      lines.push(`  ${c.muted('Start it with:')} ${c.accent('ollama serve')}`);
      lines.push('');
      return lines.join('\n');
    }

    if (!this.models.length) {
      lines.push(`  ${c.warning('●')} ${c.warning.bold('No models installed')}`);
      lines.push('');
      lines.push(this.renderDownloadGuide());
      return lines.join('\n');
    }

    // ── Installed models table ────────────────────────────────────────────────
    lines.push(`  ${c.accent.bold('Installed Models')}\n`);
    lines.push(`  ${c.muted('Name'.padEnd(38))}  ${c.muted('Tier'.padEnd(10))}  ${c.muted('Role')}`);
    lines.push(`  ${'─'.repeat(72)}`);

    for (const m of this.models) {
      const isSmall  = m === this.smallModel;
      const isMedium = m === this.currentModel;
      const isLarge  = m === this.largeModel;
      const tierLabel = isSmall ? c.muted('small') : isMedium ? c.primary('medium') : isLarge ? c.warning('large') : c.dim('—');
      const role      = isSmall ? c.muted('repo analysis, validation') : isMedium ? c.primary('coding, review, QA') : isLarge ? c.warning('planning, security') : c.dim('unassigned');
      const active    = (isSmall || isMedium || isLarge) ? c.success(' ✓') : '';
      lines.push(`  ${c.text(m.padEnd(38))}  ${tierLabel.padEnd(10)}  ${role}${active}`);
    }
    lines.push('');

    // ── Tier summary ──────────────────────────────────────────────────────────
    lines.push(`  ${c.accent.bold('Active Tiers')}`);
    lines.push(`  ${c.muted('Small  (analysis):   ')} ${this.smallModel   || c.warning('not set')}`);
    lines.push(`  ${c.muted('Medium (coding):     ')} ${this.currentModel || c.warning('not set')}`);
    lines.push(`  ${c.muted('Large  (planning):   ')} ${this.largeModel   || c.warning('not set')}`);
    lines.push('');
    lines.push(`  ${c.dim('Commands:')}  ${c.muted('/models set <name>')}  ${c.muted('/models small <name>')}  ${c.muted('/models large <name>')}`);
    lines.push(`            ${c.muted('/models suggest')} ${c.dim('— show recommended downloads')}`);

    // ── Not-installed recommendations ─────────────────────────────────────────
    const missing = this.getMissingRecommendations();
    if (missing.length) {
      lines.push('');
      lines.push(`  ${c.warning('💡 Recommended upgrades')}`);
      for (const spec of missing.slice(0, 3)) {
        lines.push(`  ${c.dim('•')} ${c.accent(`ollama pull ${spec.name}`)}  ${c.muted(`${spec.size_gb}GB · ${spec.description}`)}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /** Print the full download/suggestion guide */
  printDownloadGuide(): void {
    console.log(this.renderDownloadGuide());
  }

  /** Render download guide as a string */
  renderDownloadGuide(): string {
    const lines: string[] = [];
    const w = Math.min(process.stdout.columns || 80, 96);

    lines.push(`  ${c.warning.bold('No models installed in Ollama')}`);
    lines.push(`  ${c.muted('Pull a starter pack with the commands below, then restart SOPHOS.')}`);
    lines.push('');

    for (const pack of STARTER_PACKS) {
      lines.push(`  ${pack.label}`);
      lines.push(`  ${c.muted(pack.description)}`);
      lines.push('');
      const spec = pack;
      for (const name of [spec.small, spec.medium, spec.large]) {
        const info = RECOMMENDED_MODELS.find(m => m.name === name);
        const tier = name === spec.small ? 'small ' : name === spec.medium ? 'medium' : 'large ';
        const tierColor = name === spec.small ? c.muted : name === spec.medium ? c.primary : c.warning;
        const meta = info ? c.dim(` (${info.size_gb}GB · ${info.context_k}k ctx)`) : '';
        lines.push(`  ${c.dim('$')} ${c.accent(`ollama pull ${name}`)}  ${tierColor(`[${tier}]`)}${meta}`);
      }
      lines.push('');
    }

    lines.push(`  ${c.dim('─'.repeat(Math.min(w - 4, 70)))}`);
    lines.push(`  ${c.muted('Or set models from what you already have:')}`);
    lines.push(`  ${c.primary('/models set')} ${c.muted('<name>')}    — set medium (coding) model`);
    lines.push(`  ${c.primary('/models small')} ${c.muted('<name>')}  — set small (analysis) model`);
    lines.push(`  ${c.primary('/models large')} ${c.muted('<name>')}  — set large (planning) model`);
    lines.push('');
    lines.push(`  ${c.muted('Save to project:')} ${c.dim('.sophos/config.json')}   ${c.dim('|')}  ${c.muted('Save globally:')} ${c.dim('~/.config/sophos/config.json')}`);
    lines.push(`  ${c.primary('/models save local')}  ${c.muted('|')}  ${c.primary('/models save global')}`);
    lines.push('');

    return lines.join('\n');
  }

  /** Print offline guide */
  printOllamaOffline(): void {
    const w = Math.min(process.stdout.columns || 80, 80);
    console.log('');
    console.log(`  ${c.error('●')} ${c.error.bold('Ollama is not reachable')}`);
    console.log('');
    console.log(`  ${c.muted('Install Ollama:')}`);
    console.log(`  ${c.dim('$')} ${c.accent('curl -fsSL https://ollama.com/install.sh | sh')}   ${c.muted('(Linux/macOS)')}`);
    console.log(`  ${c.dim('$')} ${c.accent('winget install Ollama.Ollama')}                      ${c.muted('(Windows)')}`);
    console.log('');
    console.log(`  ${c.muted('Then start the server:')}`);
    console.log(`  ${c.dim('$')} ${c.accent('ollama serve')}`);
    console.log('');
    console.log(`  ${c.muted('Or point SOPHOS at a remote Ollama instance:')}`);
    console.log(`  ${c.dim('$')} ${c.accent('SOPHOS_OLLAMA_URL=http://my-server:11434 sophos')}`);
    console.log('');
  }

  /** Save current tier selection to local project config */
  saveLocal(projectDir = process.cwd()): void {
    saveLocalConfig({
      ollama: {
        model_small:    this.smallModel,
        model_medium:   this.currentModel,
        model_large:    this.largeModel,
        model_coder:    this.coderModel,
        model_planner:  this.plannerModel,
        model_executor: this.executorModel,
        model_chat:     this.chatModel,
      },
    } as any, projectDir);
  }

  /** Save current tier selection to global user config */
  saveGlobal(): void {
    saveGlobalConfig({
      ollama: {
        model_small:    this.smallModel,
        model_medium:   this.currentModel,
        model_large:    this.largeModel,
        model_coder:    this.coderModel,
        model_planner:  this.plannerModel,
        model_executor: this.executorModel,
        model_chat:     this.chatModel,
      },
    } as any);
  }

  // ── Getters / setters ──────────────────────────────────────────────────────
  getCurrentModel():   string { return this.currentModel;   }
  getSmallModel():     string { return this.smallModel;     }
  getLargeModel():     string { return this.largeModel;     }
  getCoderModel():     string { return this.coderModel;     }
  getPlannerModel():   string { return this.plannerModel;   }
  getExecutorModel():  string { return this.executorModel;  }
  getChatModel():      string { return this.chatModel;      }
  isOllamaOnline():    boolean { return this.ollamaOnline; }
  getAvailableModels(): string[] { return this.models;  }

  setCurrentModel(model: string): void {
    this.currentModel = model;
    process.env.SOPHOS_MODEL_MEDIUM = model;
  }

  setSmallModel(model: string): void {
    this.smallModel = model;
    process.env.SOPHOS_MODEL_SMALL = model;
  }

  setLargeModel(model: string): void {
    this.largeModel = model;
    process.env.SOPHOS_MODEL_LARGE = model;
  }

  setCoderModel(model: string): void {
    this.coderModel = model;
    process.env.SOPHOS_MODEL_CODER = model;
  }

  setPlannerModel(model: string): void {
    this.plannerModel = model;
    process.env.SOPHOS_MODEL_PLANNER = model;
  }

  setExecutorModel(model: string): void {
    this.executorModel = model;
    process.env.SOPHOS_MODEL_EXECUTOR = model;
  }

  setChatModel(model: string): void {
    this.chatModel = model;
    process.env.SOPHOS_MODEL_CHAT = model;
  }

  getForTier(tier: 'small' | 'medium' | 'large' | 'coder' | 'planner' | 'executor' | 'chat'): string {
    switch (tier) {
      case 'small':    return this.smallModel    || this.currentModel || this.models[0] || '';
      case 'medium':   return this.currentModel  || this.smallModel   || this.models[0] || '';
      case 'large':    return this.largeModel    || this.currentModel || this.models[0] || '';
      case 'coder':    return this.coderModel    || this.currentModel || this.models[0] || '';
      case 'planner':  return this.plannerModel  || this.largeModel   || this.models[0] || '';
      case 'executor': return this.executorModel || this.largeModel   || this.models[0] || '';
      case 'chat':     return this.chatModel     || this.currentModel || this.models[0] || '';
    }
  }

  getRecommended(forTask: string): string {
    const t = forTask.toLowerCase();
    if (t.includes('explain') || t.includes('debug') || t.includes('security')) return this.getLargeModel();
    if (t.includes('format')  || t.includes('lint')  || t.includes('analyse'))  return this.getSmallModel();
    return this.getCurrentModel();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Auto-assign tiers from installed models, prefer known-good models */
  private autoAssignFromInstalled(): boolean {
    let changed = false;

    if (!this.smallModel || !this.models.includes(this.smallModel)) {
      const m = this.bestForTier('small');
      if (m) { this.smallModel = m; changed = true; }
    }
    if (!this.currentModel || !this.models.includes(this.currentModel)) {
      const m = this.bestForTier('medium');
      if (m) { this.currentModel = m; changed = true; }
    }
    if (!this.largeModel || !this.models.includes(this.largeModel)) {
      const m = this.bestForTier('large');
      if (m) { this.largeModel = m; changed = true; }
    }
    if (!this.coderModel || !this.models.includes(this.coderModel)) {
      this.coderModel = this.currentModel || this.bestForTier('medium');
      changed = true;
    }
    if (!this.plannerModel || !this.models.includes(this.plannerModel)) {
      this.plannerModel = this.largeModel || this.bestForTier('large');
      changed = true;
    }
    if (!this.executorModel || !this.models.includes(this.executorModel)) {
      this.executorModel = this.largeModel || this.bestForTier('large');
      changed = true;
    }
    if (!this.chatModel || !this.models.includes(this.chatModel)) {
      this.chatModel = this.currentModel || this.bestForTier('medium');
      changed = true;
    }

    if (changed) {
      console.log('');
      console.log(`  ${c.success('✓')} Auto-assigned models from installed list:`);
      console.log(`  ${c.muted('Small:    ')} ${c.text(this.smallModel    || c.warning('none'))}`);
      console.log(`  ${c.muted('Medium:   ')} ${c.text(this.currentModel  || c.warning('none'))}`);
      console.log(`  ${c.muted('Large:    ')} ${c.text(this.largeModel    || c.warning('none'))}`);
      console.log(`  ${c.muted('Coder:    ')} ${c.text(this.coderModel    || c.warning('none'))}`);
      console.log(`  ${c.muted('Planner:  ')} ${c.text(this.plannerModel  || c.warning('none'))}`);
      console.log(`  ${c.muted('Executor: ')} ${c.text(this.executorModel || c.warning('none'))}`);
      console.log(`  ${c.muted('Chat:     ')} ${c.text(this.chatModel     || c.warning('none'))}`);
      console.log(`  ${c.dim('Run')} ${c.primary('/models save local')} ${c.dim('or')} ${c.primary('/models save global')} ${c.dim('to persist.')}`);
      console.log('');
    }

    return changed || (!!this.currentModel);
  }

  /** Find the best installed model for a tier based on the curated catalogue */
  private bestForTier(tier: 'small' | 'medium' | 'large'): string {
    const preferred = RECOMMENDED_MODELS
      .filter(s => s.tier === tier)
      .map(s => s.name);

    // Exact match first
    for (const p of preferred) {
      if (this.models.includes(p)) return p;
    }

    // Prefix match (e.g. user pulled "codellama" without tag)
    for (const p of preferred) {
      const base = p.split(':')[0];
      const found = this.models.find(m => m.startsWith(base));
      if (found) return found;
    }

    // Fallback: any installed model for this tier based on name heuristics
    const tierHints: Record<string, string[]> = {
      small:  ['1b', '1.5b', '3b', '7b'],
      medium: ['7b', '13b', '14b', '8b'],
      large:  ['34b', '32b', '70b', '72b', '30b'],
    };
    for (const hint of tierHints[tier]) {
      const found = this.models.find(m => m.includes(hint));
      if (found) return found;
    }

    // Last resort: any model
    return this.models[0] || '';
  }

  /** Models in catalogue but not installed */
  private getMissingRecommendations(): ModelSpec[] {
    return RECOMMENDED_MODELS.filter(spec =>
      !this.models.some(m => m === spec.name || m.startsWith(spec.name.split(':')[0]))
    );
  }
}
