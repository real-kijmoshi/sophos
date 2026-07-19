// ── Model Selector v3.0 ───────────────────────────────────────────────────────
// Handles discovery, setup wizard, download suggestions, and runtime overrides.
// Supports project-local (.sophos.json) and global (~/.config/sophos/config.json) config.

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { OllamaClient }    from '../llm/client.js';
import { loadConfig, saveLocalConfig, saveGlobalConfig, getGlobalConfigPath, getDefaultConfigPath } from '../config/config.js';
import { c, formatNumber, ANSI } from './ui.js';

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

  // ── Role definitions ──────────────────────────────────────────────────────────
  private static ROLES: Array<{
    key:       'smallModel' | 'currentModel' | 'largeModel' | 'coderModel' | 'plannerModel' | 'executorModel' | 'chatModel';
    tier:      'small' | 'medium' | 'large' | 'coder' | 'planner' | 'executor' | 'chat';
    label:     string;
    icon:      string;
    color:     (s: string) => string;
    desc:      string;
    phaseHint: string;
  }> = [
    { key: 'smallModel',     tier: 'small',    label: 'scanner',   icon: '🔍', color: c.muted,     desc: 'repo scanning, validation, integration', phaseHint: 'phase 1, 6, 8' },
    { key: 'currentModel',   tier: 'medium',   label: 'base',      icon: '⚙️', color: c.secondary,  desc: 'base model (medium tier default)',         phaseHint: 'fallback' },
    { key: 'largeModel',     tier: 'large',    label: 'architect', icon: '🧠', color: c.warning,   desc: 'deep analysis, complex reasoning',         phaseHint: 'fallback' },
    { key: 'coderModel',     tier: 'coder',    label: 'coder',     icon: '💻', color: c.primary,   desc: 'code generation, review, QA',             phaseHint: 'phase 4, 5, 7, 9' },
    { key: 'plannerModel',   tier: 'planner',  label: 'planner',   icon: '📋', color: c.purple,    desc: 'planning swarm, consensus, synthesis',     phaseHint: 'phase 2, 5-consensus, 7-deep' },
    { key: 'executorModel',  tier: 'executor', label: 'executor',  icon: '⚡', color: c.orange,    desc: 'execution planning, task graph',           phaseHint: 'phase 3' },
    { key: 'chatModel',      tier: 'chat',     label: 'chat',      icon: '💬', color: c.info,      desc: 'conversational, REPL, explanations',       phaseHint: '/chat' },
  ];

  private getRoleValue(role: typeof ModelSelector.ROLES[number]): string {
    return (this as any)[role.key] as string;
  }

  private setRoleValue(role: typeof ModelSelector.ROLES[number], model: string): void {
    (this as any)[role.key] = model;
    const envMap: Record<string, string> = {
      smallModel:    'SOPHOS_MODEL_SMALL',
      currentModel:  'SOPHOS_MODEL_MEDIUM',
      largeModel:    'SOPHOS_MODEL_LARGE',
      coderModel:    'SOPHOS_MODEL_CODER',
      plannerModel:  'SOPHOS_MODEL_PLANNER',
      executorModel: 'SOPHOS_MODEL_EXECUTOR',
      chatModel:     'SOPHOS_MODEL_CHAT',
    };
    process.env[envMap[role.key]] = model;
  }

  /**
   * Show the model status panel — all 7 roles with their assigned models.
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

    // ── Role assignment table ──────────────────────────────────────────────────
    lines.push(`  ${c.accent.bold('Model Roles')}\n`);

    const roleW = 10, modelW = 30, descW = 32;
    lines.push(`  ${c.muted('Role'.padEnd(roleW))}  ${c.muted('Model'.padEnd(modelW))}  ${c.muted('Used by')}`);
    lines.push(`  ${c.dim('─'.repeat(roleW + modelW + descW + 4))}`);

    for (const role of ModelSelector.ROLES) {
      const model = this.getRoleValue(role);
      const isActive  = !!model;
      const isInstalled = model ? this.models.includes(model) : false;
      const modelStr = model
        ? (isInstalled ? role.color(model) : c.warning(model + ' ⚠'))
        : c.dim('— not set —');
      const check = isActive ? (isInstalled ? c.success(' ✓') : c.warning(' ⚠')) : '';
      lines.push(`  ${role.icon} ${c.dim(role.label.padEnd(roleW - 3))}  ${modelStr.padEnd(modelW + (isActive ? 0 : 0))}  ${c.dim(role.desc)}${check}`);
    }
    lines.push('');

    // ── Quick commands ─────────────────────────────────────────────────────────
    lines.push(`  ${c.dim('Set role:')}  ${c.muted('/models coder <name>')}  ${c.muted('/models planner <name>')}  ${c.muted('/models executor <name>')}`);
    lines.push(`               ${c.muted('/models chat <name>')}     ${c.muted('/models scanner <name>')}   ${c.muted('/models architect <name>')}`);
    lines.push(`  ${c.dim('Other:')}    ${c.primary('/models suggest')} ${c.dim('— smart upgrade suggestions')}   ${c.primary('/models wizard')} ${c.dim('— interactive setup')}`);
    lines.push(`               ${c.primary('/models assign')}  ${c.dim('— interactive role assignment')}  ${c.primary('/models save local|global')}`);

    // ── Not-installed warnings ─────────────────────────────────────────────────
    const unassigned = ModelSelector.ROLES.filter(r => !this.getRoleValue(r));
    const missing    = this.getMissingRecommendations();
    if (unassigned.length) {
      lines.push('');
      lines.push(`  ${c.warning('⚠')} ${c.warning(`${unassigned.length} role(s) unassigned`)} — ${c.dim('run')} ${c.primary('/models assign')} ${c.dim('to configure')}`);
    }
    if (missing.length) {
      lines.push('');
      lines.push(`  ${c.dim('Suggested downloads:')}`);
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
      case 'small':    return this.smallModel;
      case 'medium':   return this.currentModel;
      case 'large':    return this.largeModel;
      case 'coder':    return this.coderModel;
      case 'planner':  return this.plannerModel;
      case 'executor': return this.executorModel;
      case 'chat':     return this.chatModel;
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

    // Prefer different models per role — pick by size heuristics
    const bySize = [...this.models].sort((a, b) => {
      const parseSize = (m: string) => {
        const match = m.match(/[:\-](\d+\.?\d*)b/i);
        return match ? parseFloat(match[1]) : 0;
      };
      return parseSize(a) - parseSize(b);
    });

    const smallest  = bySize[0]  || '';
    const biggest   = bySize[bySize.length - 1] || '';
    const mid       = bySize[Math.floor(bySize.length / 2)] || '';
    const used      = new Set<string>();

    const pick = (candidates: string[]) => {
      for (const c of candidates) {
        if (this.models.includes(c) && !used.has(c)) { used.add(c); return c; }
      }
      return '';
    };

    if (!this.smallModel || !this.models.includes(this.smallModel)) {
      this.smallModel = pick([smallest, ...this.models.filter(m => /1b|1\.5b|3b|7b/i.test(m))]) || this.bestForTier('small');
      if (this.smallModel) changed = true;
    }
    if (!this.currentModel || !this.models.includes(this.currentModel)) {
      this.currentModel = pick([mid, ...this.models.filter(m => /7b|8b|9b|12b|14b/i.test(m))]) || this.bestForTier('medium');
      if (this.currentModel) changed = true;
    }
    if (!this.largeModel || !this.models.includes(this.largeModel)) {
      this.largeModel = pick([biggest, ...this.models.filter(m => /32b|34b|70b|72b/i.test(m))]) || this.bestForTier('large');
      if (this.largeModel) changed = true;
    }
    if (!this.coderModel || !this.models.includes(this.coderModel)) {
      this.coderModel = pick(this.models.filter(m => /coder|codellama|code/i.test(m) && !used.has(m)))
        || pick(this.models.filter(m => !used.has(m)))
        || this.bestForTier('medium');
      if (this.coderModel) changed = true;
    }
    if (!this.plannerModel || !this.models.includes(this.plannerModel)) {
      this.plannerModel = pick(this.models.filter(m => !used.has(m))) || this.bestForTier('large');
      if (this.plannerModel) changed = true;
    }
    if (!this.executorModel || !this.models.includes(this.executorModel)) {
      this.executorModel = pick(this.models.filter(m => !used.has(m))) || this.bestForTier('medium');
      if (this.executorModel) changed = true;
    }
    if (!this.chatModel || !this.models.includes(this.chatModel)) {
      this.chatModel = pick(this.models.filter(m => /chat|instruct|general/i.test(m) && !used.has(m)))
        || pick(this.models.filter(m => !used.has(m)))
        || this.bestForTier('medium');
      if (this.chatModel) changed = true;
    }

    if (changed) {
      console.log('');
      console.log(`  ${c.success('✓')} Auto-assigned models (each role gets a distinct model):`);
      for (const role of ModelSelector.ROLES) {
        const val = this.getRoleValue(role);
        console.log(`  ${role.icon} ${c.dim(role.label.padEnd(9))} ${val ? c.text(val) : c.warning('none')}`);
      }
      console.log(`  ${c.dim('Run')} ${c.primary('/models save local')} ${c.dim('or')} ${c.primary('/models save global')} ${c.dim('to persist.')}`);
      console.log('');
    }

    return changed || (!!this.currentModel);
  }

  // ── Interactive TUI ──────────────────────────────────────────────────────────
  /**
   * Interactive arrow-key model assignment.
   * For each role, shows a selectable list of installed models.
   * Returns true if any assignments were made.
   */
  async runInteractiveAssign(): Promise<boolean> {
    if (!this.ollamaOnline) { this.printOllamaOffline(); return false; }
    if (!this.models.length) { this.printDownloadGuide(); return false; }

    const w = Math.min(process.stdout.columns || 80, 96);
    let anyChanged = false;

    for (const role of ModelSelector.ROLES) {
      const current = this.getRoleValue(role);
      const result  = await this.promptModelPicker(role, current, w);
      if (result !== null && result !== current) {
        this.setRoleValue(role, result);
        anyChanged = true;
      }
    }

    if (anyChanged) {
      console.log('');
      console.log(`  ${c.success('✓')} Roles updated. ${c.dim('Run')} ${c.primary('/models save local')} ${c.dim('to persist.')}`);
    }
    console.log('');
    return anyChanged;
  }

  private promptModelPicker(
    role:     typeof ModelSelector.ROLES[number],
    current:  string,
    width:    number,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      let cursor = Math.max(0, this.models.indexOf(current));
      if (cursor < 0) cursor = 0;
      let scroll = 0;
      const maxVisible = Math.min(12, this.models.length);
      let linesRendered = 0;

      const render = () => {
        // Clear previous output
        if (linesRendered > 0) {
          process.stdout.write(`\x1B[${linesRendered}A\x1B[0J`);
          linesRendered = 0;
        }

        const lines: string[] = [];
        lines.push(`  ${role.icon} ${c.accent.bold(role.label)} ${c.dim('—')} ${c.dim(role.desc)}`);
        lines.push(`  ${c.dim('phase:')} ${c.muted(role.phaseHint)}`);
        lines.push('');

        // Model list
        for (let i = 0; i < maxVisible; i++) {
          const idx = scroll + i;
          if (idx >= this.models.length) break;
          const m = this.models[idx];
          const isSelected = m === current;
          const isCursor   = idx === cursor;
          const prefix     = isCursor ? c.accent.bold('▸ ') : '  ';
          const check      = isSelected ? c.success(' (current)') : '';
          const tag        = role.tier === 'small'    && /1b|1\.5b|3b|7b/i.test(m) ? c.dim(' [light]')
                           : role.tier === 'medium'   && /7b|8b|9b|12b|14b/i.test(m) ? c.dim(' [mid]')
                           : role.tier === 'large'    && /32b|34b|70b|72b|30b/i.test(m) ? c.dim(' [heavy]')
                           : '';
          lines.push(`${prefix}${c.text(m)}${tag}${check}`);
        }

        lines.push('');
        lines.push(`  ${c.dim('↑↓')} select  ${c.dim('↵')} assign  ${c.dim('esc')} skip  ${c.dim(`${this.models.length} models`)}`);

        const output = lines.join('\n');
        process.stdout.write(output + '\n');
        linesRendered = lines.filter(l => l.includes('\n') || l.length > 0).length + 1;
      };

      process.stdout.write(ANSI.hideCursor);
      render();

      const onKeypress = (_str: string, key: any) => {
        switch (key?.name) {
          case 'up':
            cursor = Math.max(0, cursor - 1);
            if (cursor < scroll) scroll = cursor;
            render();
            break;
          case 'down':
            cursor = Math.min(this.models.length - 1, cursor + 1);
            if (cursor >= scroll + maxVisible) scroll = cursor - maxVisible + 1;
            render();
            break;
          case 'return':
            cleanup();
            resolve(this.models[cursor] || null);
            break;
          case 'escape':
          case 'c':
            if (key?.name === 'c' && !key?.ctrl) break;
            cleanup();
            resolve(null);
            break;
        }
      };

      const cleanup = () => {
        process.stdin.removeListener('keypress', onKeypress);
        process.stdout.write(ANSI.showCursor);
        if (linesRendered > 0) {
          process.stdout.write(`\x1B[${linesRendered}A\x1B[0J`);
          linesRendered = 0;
        }
      };

      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('keypress', onKeypress);
    });
  }

  // ── Smart suggestions ────────────────────────────────────────────────────────
  /**
   * Analyze installed models and suggest role assignments + upgrades.
   * Returns a formatted string for display.
   */
  formatSuggestions(): string {
    const lines: string[] = ['\n'];

    if (!this.ollamaOnline) {
      lines.push(`  ${c.error('●')} ${c.error.bold('Ollama is not running')}`);
      lines.push('');
      return lines.join('\n');
    }

    if (!this.models.length) {
      lines.push(`  ${c.warning('●')} ${c.warning.bold('No models installed')}`);
      lines.push('');
      lines.push(this.renderDownloadGuide());
      return lines.join('\n');
    }

    lines.push(`  ${c.accent.bold('Smart Suggestions')}\n`);

    // Analyze installed models by size
    const analyzed = this.models.map(m => {
      const sizeMatch = m.match(/[:\-](\d+\.?\d*)b/i);
      const sizeB     = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
      const isCoder   = /coder|codellama|code|deepseek/i.test(m);
      const isChat    = /chat|instruct|general|gemma|yi/i.test(m);
      return { name: m, sizeB, isCoder, isChat };
    }).sort((a, b) => a.sizeB - b.sizeB);

    // Suggest optimal role assignments
    lines.push(`  ${c.dim('Optimal role assignment based on your models:')}\n`);

    const suggestions: Array<{ role: typeof ModelSelector.ROLES[number]; model: string; reason: string }> = [];

    // Scanner: smallest model
    if (analyzed.length) {
      suggestions.push({ role: ModelSelector.ROLES[0], model: analyzed[0].name, reason: `smallest (${analyzed[0].sizeB}B) — fast scanning` });
    }

    // Coder: largest coder model
    const coders = analyzed.filter(m => m.isCoder);
    if (coders.length) {
      const best = coders[coders.length - 1];
      suggestions.push({ role: ModelSelector.ROLES[3], model: best.name, reason: `strongest coder model (${best.sizeB}B)` });
    }

    // Planner: largest non-coder model
    const planners = analyzed.filter(m => !m.isCoder && m.sizeB > 10);
    if (planners.length) {
      const best = planners[planners.length - 1];
      suggestions.push({ role: ModelSelector.ROLES[4], model: best.name, reason: `large general model (${best.sizeB}B) — deep reasoning` });
    } else if (analyzed.length > 1) {
      suggestions.push({ role: ModelSelector.ROLES[4], model: analyzed[analyzed.length - 1].name, reason: `largest available — best for planning` });
    }

    // Executor: mid-size model that follows instructions
    const executors = analyzed.filter(m => m.sizeB >= 7 && m.sizeB <= 34);
    if (executors.length) {
      suggestions.push({ role: ModelSelector.ROLES[5], model: executors[0].name, reason: `mid-range (${executors[0].sizeB}B) — reliable execution` });
    }

    // Chat: chat/instruct model
    const chatters = analyzed.filter(m => m.isChat);
    if (chatters.length) {
      suggestions.push({ role: ModelSelector.ROLES[6], model: chatters[chatters.length - 1].name, reason: `instruction-tuned — natural conversation` });
    }

    // Architect: largest overall
    if (analyzed.length > 2) {
      suggestions.push({ role: ModelSelector.ROLES[2], model: analyzed[analyzed.length - 1].name, reason: `largest model (${analyzed[analyzed.length - 1].sizeB}B) — complex analysis` });
    }

    // Base: mid-range
    if (analyzed.length > 3) {
      const mid = analyzed[Math.floor(analyzed.length / 2)];
      suggestions.push({ role: ModelSelector.ROLES[1], model: mid.name, reason: `balanced (${mid.sizeB}B) — general fallback` });
    }

    for (const s of suggestions) {
      const current = this.getRoleValue(s.role);
      const same    = current === s.model;
      const check   = same ? c.success(' ✓') : '';
      const cmd     = same ? '' : c.dim(` → /models ${s.role.tier} ${s.model}`);
      lines.push(`  ${s.role.icon} ${s.role.color(s.role.label.padEnd(9))} ${c.text(s.model)}${check}`);
      lines.push(`    ${c.dim(s.reason)}${cmd}`);
    }

    // Suggest downloads for empty roles
    const emptyRoles = ModelSelector.ROLES.filter(r => !this.getRoleValue(r));
    if (emptyRoles.length) {
      lines.push('');
      const emptyMsg = emptyRoles.length + ' role(s) still unassigned:';
      lines.push(`  ${c.warning('⚠')} ${c.warning(emptyMsg)}`);
      for (const r of emptyRoles) {
        lines.push(`  ${r.icon} ${c.dim(r.label)} — ${c.muted(r.desc)}`);
      }
    }

    // Suggest upgrades
    const upgrades = this.getUpgradeSuggestions();
    if (upgrades.length) {
      lines.push('');
      lines.push(`  ${c.info('↑')} ${c.info.bold('Upgrade suggestions')}`);
      for (const u of upgrades.slice(0, 3)) {
        lines.push(`  ${c.dim('•')} ${c.accent(`ollama pull ${u.name}`)}  ${c.muted(`${u.size_gb}GB · ${u.description}`)}`);
        lines.push(`    ${c.dim(u.reason)}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  private getUpgradeSuggestions(): Array<ModelSpec & { reason: string }> {
    const results: Array<ModelSpec & { reason: string }> = [];

    // If no coder model or using a tiny one
    if (!this.coderModel || this.coderModel === this.smallModel) {
      const bestCoder = RECOMMENDED_MODELS.find(m => m.tier === 'medium' && m.strengths.includes('coding'));
      if (bestCoder && !this.models.includes(bestCoder.name)) {
        results.push({ ...bestCoder, reason: `Upgrade coder role — current is too small for reliable code generation` });
      }
    }

    // If no planner or using same as coder
    if (!this.plannerModel || this.plannerModel === this.coderModel) {
      const bestPlanner = RECOMMENDED_MODELS.find(m => m.tier === 'large' && m.strengths.includes('planning'));
      if (bestPlanner && !this.models.includes(bestPlanner.name)) {
        results.push({ ...bestPlanner, reason: `Dedicated planner model — improves planning swarm quality` });
      }
    }

    return results;
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
