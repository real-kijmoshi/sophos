// ── Hardware Detector v2 ──────────────────────────────────────────────────────
// Singleton-cached detection. Queries nvidia-smi / Ollama API for live VRAM.
// Used to auto-tune concurrent_requests across all swarm phases.

import { execSync } from 'node:child_process';
import * as os from 'node:os';
import { RECOMMENDED_MODELS, type ModelSpec } from '../cli/model-selector.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GPUInfo {
  vendor:       'nvidia' | 'amd' | 'apple' | 'unknown';
  name:         string;        // e.g. "NVIDIA GeForce RTX 3090"
  vram_total_mb: number;
  vram_used_mb:  number;       // currently allocated by all processes
  vram_free_mb:  number;
}

export interface HardwareSpecs {
  gpu:            GPUInfo | null;
  system_ram_mb:  number;
  cpu_cores:      number;
}

export interface LoadedModel {
  name:           string;
  size_gb:        number;
  vram_mb:        number;      // VRAM currently占用
  context_length: number;
}

export interface ConcurrencyPlan {
  concurrent_requests: number;
  vram_budget_mb:      number;  // per-instance budget
  model_vram_gb:       number | null;
  loaded_models:       LoadedModel[];
  reasons:             string[];
}

// ── Singleton cache ──────────────────────────────────────────────────────────

let _cache: HardwareSpecs | null = null;

export function detectHardware(force = false): HardwareSpecs {
  if (_cache && !force) return _cache;
  _cache = {
    gpu:            detectGPU(),
    system_ram_mb:  Math.round(os.totalmem() / 1024 / 1024),
    cpu_cores:      os.cpus().length,
  };
  return _cache;
}

// ── GPU detection ────────────────────────────────────────────────────────────

function detectGPU(): GPUInfo | null {
  return detectNvidia() ?? detectAMD() ?? detectAppleSilicon() ?? null;
}

function detectNvidia(): GPUInfo | null {
  try {
    // GPU name + VRAM in one call
    const raw = execSync(
      'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const line = raw.trim().split('\n')[0]?.trim();
    if (!line) return null;
    // Format: "NVIDIA GeForce RTX 3090, 24576, 1024, 23552"
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 4) return null;
    const name    = parts[0];
    const total   = parseInt(parts[1], 10);
    const used    = parseInt(parts[2], 10);
    const free    = parseInt(parts[3], 10);
    if (isNaN(total)) return null;
    return { vendor: 'nvidia', name, vram_total_mb: total, vram_used_mb: used, vram_free_mb: free };
  } catch { return null; }
}

function detectAMD(): GPUInfo | null {
  try {
    const raw = execSync(
      'rocm-smi --showmeminfo vram --csv 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000, shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const lines = raw.trim().split('\n');
    if (lines.length < 2) return null;
    // Header: device, total_memory, used_memory, free_memory
    const parts = lines[1].split(',').map(s => s.trim());
    const totalKB = parseInt(parts[1] || '', 10);
    const usedKB  = parseInt(parts[2] || '', 10);
    const freeKB  = parseInt(parts[3] || '', 10);
    if (isNaN(totalKB)) return null;
    // Try to get GPU name
    let gpuName = 'AMD GPU';
    try {
      const nameRaw = execSync('rocm-smi --showproductname 2>/dev/null', {
        encoding: 'utf-8', timeout: 3000, shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const m = nameRaw.match(/Card\s*\[.+\]\s*:\s*(.+)/i);
      if (m) gpuName = m[1].trim();
    } catch { /* */ }
    return {
      vendor: 'amd', name: gpuName,
      vram_total_mb: Math.round(totalKB / 1024),
      vram_used_mb:  Math.round(usedKB / 1024),
      vram_free_mb:  Math.round(freeKB / 1024),
    };
  } catch { return null; }
}

function detectAppleSilicon(): GPUInfo | null {
  try {
    const raw = execSync('sysctl hw.memsize', {
      encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const bytes = parseInt(raw.split(':')[1]?.trim() || '', 10);
    if (isNaN(bytes)) return null;
    const totalMB = Math.round(bytes / 1024 / 1024);
    const usableMB = Math.round(totalMB * 0.8);
    return {
      vendor: 'apple', name: 'Apple Silicon (unified memory)',
      vram_total_mb: usableMB, vram_used_mb: 0, vram_free_mb: usableMB,
    };
  } catch { return null; }
}

// ── Query Ollama for loaded models ───────────────────────────────────────────

export async function queryLoadedModels(baseUrl: string): Promise<LoadedModel[]> {
  try {
    const res = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const models = data.models ?? [];
    return models.map((m: any) => ({
      name:           m.name || '',
      size_gb:        m.size ? Math.round(m.size / 1024 / 1024 / 1024 * 10) / 10 : 0,
      vram_mb:        m.size ? Math.round(m.size / 1024 / 1024) : 0,
      context_length: m.details?.parameter_size || 0,
    }));
  } catch { return []; }
}

// ── Model VRAM lookup ────────────────────────────────────────────────────────

/**
 * Look up expected VRAM for a model. Uses RECOMMENDED_MODELS catalogue first,
 * then falls back to heuristic estimation from model name.
 */
export function lookupModelVRAM(modelName: string): number | null {
  // 1. Exact match in catalogue
  const exact = RECOMMENDED_MODELS.find(m => m.name === modelName);
  if (exact) return exact.vram_gb;

  // 2. Partial match (e.g. "qwen2.5-coder:7b-instruct" → matches "qwen2.5-coder:7b")
  for (const spec of RECOMMENDED_MODELS) {
    if (modelName.startsWith(spec.name) || modelName.includes(spec.name.split(':')[1])) {
      return spec.vram_gb;
    }
  }

  // 3. Parse parameter count from name and estimate
  const match = modelName.match(/[:\-](\d+\.?\d*)b/i);
  if (match) {
    const sizeB = parseFloat(match[1]);
    // FP16: ~2GB/B, Q8: ~1GB/B, Q4_K_M: ~0.6GB/B
    // Assume mixed precision: ~1.5GB per billion params
    return Math.round(sizeB * 1.5 * 10) / 10;
  }

  return null;
}

// ── Context window VRAM overhead ─────────────────────────────────────────────

/**
 * Estimate additional VRAM needed per token of context.
 * Rule of thumb: ~0.5 MB per 1K tokens for 7B models, scales with params.
 */
function contextOverheadMB(numCtx: number, modelParamsB: number | null): number {
  const tokensK = numCtx / 1024;
  const mbPerK  = modelParamsB ? Math.max(0.2, modelParamsB * 0.08) : 1.0;
  return Math.round(tokensK * mbPerK);
}

// ── Core: calculate optimal concurrency ──────────────────────────────────────

export async function calculateConcurrency(
  config: { ollama: { base_url: string; num_ctx: number; concurrent_requests: number }; model_planner?: string; model_large?: string; model_medium?: string; model_coder?: string },
): Promise<ConcurrencyPlan> {
  const specs   = detectHardware();
  const reasons: string[] = [];

  // Determine which model will be used for swarm agents
  const modelName = config.model_planner || config.model_large || config.model_medium || config.model_coder || '';
  const modelVramGB = modelName ? lookupModelVRAM(modelName) : null;

  // Parse param count for context overhead calc
  const paramMatch = modelName.match(/[:\-](\d+\.?\d*)b/i);
  const paramCount = paramMatch ? parseFloat(paramMatch[1]) : null;

  // Query Ollama for currently loaded models
  const loaded = await queryLoadedModels(config.ollama.base_url);

  if (!specs.gpu) {
    // ── CPU mode ────────────────────────────────────────────────────────────
    const ramGB      = specs.system_ram_mb / 1024;
    const availGB    = ramGB - 2; // OS headroom
    const perModelGB = (modelVramGB || 4) + (config.ollama.num_ctx / 1024 * 0.001);
    const ramMax     = Math.floor(availGB / perModelGB);
    const coreMax    = Math.max(1, Math.floor(specs.cpu_cores / 2));
    const optimal    = Math.min(ramMax, coreMax, 6);

    reasons.push(`CPU mode: ${specs.cpu_cores} cores, ${Math.round(ramGB)}GB RAM`);
    if (modelName) reasons.push(`Model: ${modelName} (~${modelVramGB || '?'}GB)`);
    reasons.push(`${Math.max(1, optimal)} instances fit in RAM`);

    return {
      concurrent_requests: Math.max(1, optimal),
      vram_budget_mb:      0,
      model_vram_gb:       modelVramGB,
      loaded_models:       loaded,
      reasons,
    };
  }

  // ── GPU mode ────────────────────────────────────────────────────────────────
  const gpu = specs.gpu;
  reasons.push(`${gpu.name}: ${Math.round(gpu.vram_total_mb / 1024)}GB total, ${Math.round(gpu.vram_free_mb / 1024)}GB free`);

  // Subtract VRAM already used by other loaded models
  const usedByOthers = loaded.reduce((sum, m) => sum + m.vram_mb, 0);
  const effectiveFree = gpu.vram_free_mb;

  if (usedByOthers > 0) {
    reasons.push(`${loaded.length} model(s) loaded in Ollama (${Math.round(usedByOthers / 1024)}GB used)`);
  }

  if (!modelVramGB) {
    // Unknown model — use VRAM tiers
    const freeGB = effectiveFree / 1024;
    let optimal: number;
    if (freeGB >= 40)      optimal = 8;
    else if (freeGB >= 20) optimal = 6;
    else if (freeGB >= 10) optimal = 4;
    else if (freeGB >= 6)  optimal = 3;
    else                   optimal = 2;
    optimal = Math.min(optimal, specs.cpu_cores, 8);
    reasons.push(`Unknown model — ${Math.round(freeGB)}GB free VRAM → ${Math.max(1, optimal)} instances`);

    return {
      concurrent_requests: Math.max(1, optimal),
      vram_budget_mb:      effectiveFree,
      model_vram_gb:       null,
      loaded_models:       loaded,
      reasons,
    };
  }

  // Known model — precise calculation
  const modelVramMB   = modelVramGB * 1024;
  const contextMB     = contextOverheadMB(config.ollama.num_ctx, paramCount);
  const perInstanceMB = modelVramMB + contextMB;
  const overheadMB    = 1536; // CUDA/ROCm runtime overhead
  const availableMB   = effectiveFree - overheadMB;
  const maxByVRAM     = Math.max(0, Math.floor(availableMB / perInstanceMB));
  const maxByCPU      = Math.max(1, Math.floor(specs.cpu_cores / 2));
  const optimal       = Math.min(maxByVRAM, maxByCPU, 8);

  reasons.push(`${modelVramGB}GB model + ${Math.round(contextMB)}MB context (${config.ollama.num_ctx / 1000}K tokens) = ${Math.round(perInstanceMB / 1024 * 10) / 10}GB/instance`);
  reasons.push(`${Math.round(availableMB / 1024)}GB available after overhead → ${maxByVRAM} fit by VRAM, ${maxByCPU} by CPU`);

  if (optimal <= 0) {
    reasons.push(`⚠ Model too large for available VRAM — reduce context or use a smaller model`);
  } else if (optimal < 4) {
    reasons.push(`💡 Tip: reduce num_ctx or close other GPU apps to increase concurrency`);
  }

  return {
    concurrent_requests: Math.max(1, optimal),
    vram_budget_mb:      perInstanceMB,
    model_vram_gb:       modelVramGB,
    loaded_models:       loaded,
    reasons,
  };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export function formatGPU(gpu: GPUInfo | null): string {
  if (!gpu) return 'No GPU';
  const freeGB = (gpu.vram_free_mb / 1024).toFixed(1);
  const totalGB = (gpu.vram_total_mb / 1024).toFixed(0);
  return `${gpu.name} (${freeGB}/${totalGB}GB free)`;
}

export function formatConcurrencyPlan(plan: ConcurrencyPlan): string {
  const lines: string[] = [];
  lines.push(`Concurrency: ${plan.concurrent_requests} simultaneous agents`);
  for (const r of plan.reasons) {
    lines.push(`  ${r}`);
  }
  if (plan.loaded_models.length) {
    lines.push(`  Loaded models:`);
    for (const m of plan.loaded_models) {
      lines.push(`    - ${m.name} (${Math.round(m.vram_mb / 1024)}GB)`);
    }
  }
  return lines.join('\n');
}
