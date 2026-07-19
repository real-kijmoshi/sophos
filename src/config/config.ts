import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as os   from 'node:os';

export interface SophosConfig {
  ollama: {
    base_url:            string;
    model_small:         string;
    model_medium:        string;
    model_large:         string;
    model_coder:         string;
    model_planner:       string;
    model_executor:      string;
    model_chat:          string;
    temperature:         number;
    top_p:               number;
    num_ctx:             number;
    timeout_ms:          number;
    max_retries:         number;
    concurrent_requests: number;
  };
  pipeline: {
    max_review_iterations: number;
    max_repair_attempts:   number;
    skip_validation:       boolean;
    skip_security:         boolean;
    dry_run:               boolean;
  };
  output: {
    verbose:     boolean;
    show_diffs:  boolean;
    save_patches:boolean;
  };
  webui: {
    enabled:  boolean;
    port:     number;
    host:     string;
  };
  mcp: {
    enabled:  boolean;
  };
  tunnel: {
    enabled:  boolean;
    provider: 'cloudflared' | 'localtunnel' | 'ngrok' | 'auto';
    port:     number;
  };
}

export const DEFAULT_CONFIG: SophosConfig = {
  ollama: {
    base_url:            'http://localhost:11434',
    model_small:         '',
    model_medium:        '',
    model_large:         '',
    model_coder:         '',
    model_planner:       '',
    model_executor:      '',
    model_chat:          '',
    temperature:         0.3,
    top_p:               0.95,
    num_ctx:             16384,
    timeout_ms:          300000,
    max_retries:         3,
    concurrent_requests: 4,
  },
  pipeline: {
    max_review_iterations: 3,
    max_repair_attempts:   2,
    skip_validation:       false,
    skip_security:         false,
    dry_run:               false,
  },
  output: {
    verbose:      false,
    show_diffs:   true,
    save_patches: true,
  },
  webui: {
    enabled:  false,
    port:     3777,
    host:     '0.0.0.0',
  },
  mcp: {
    enabled:  false,
  },
  tunnel: {
    enabled:  false,
    provider: 'auto',
    port:     3777,
  },
};

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Global config: ~/.config/sophos/config.json */
export function getGlobalConfigPath(): string {
  return path.join(os.homedir(), '.config', 'sophos', 'config.json');
}

/** Project-local config: <cwd>/.sophos.json (legacy) */
export function getDefaultConfigPath(): string {
  return path.join(process.cwd(), '.sophos.json');
}

/** Project store config: <cwd>/.sophos/config.json */
export function getProjectConfigPath(projectDir?: string): string {
  return path.join(projectDir || process.cwd(), '.sophos', 'config.json');
}

// ── Load ──────────────────────────────────────────────────────────────────────
/**
 * Config merge order (later wins):
 *   1. Built-in defaults
 *   2. Global config  (~/.config/sophos/config.json)
 *   3. Project config  (./.sophos/config.json — preferred)
 *   4. Legacy config   (./.sophos.json — fallback)
 *   5. Environment variables (SOPHOS_*)
 */
export function loadConfig(localConfigPath?: string): SophosConfig {
  const config = deepClone(DEFAULT_CONFIG);

  // 2. Global
  const globalPath = getGlobalConfigPath();
  if (fs.existsSync(globalPath)) {
    try {
      mergeConfig(config, JSON.parse(fs.readFileSync(globalPath, 'utf-8')));
    } catch {
      // ignore corrupt global config
    }
  }

  // 3. Project store config (.sophos/config.json) — preferred
  const projectPath = localConfigPath || getProjectConfigPath();
  if (fs.existsSync(projectPath)) {
    try {
      mergeConfig(config, JSON.parse(fs.readFileSync(projectPath, 'utf-8')));
    } catch {
      // ignore
    }
  } else {
    // 4. Legacy .sophos.json fallback
    const legacyPath = localConfigPath || getDefaultConfigPath();
    if (fs.existsSync(legacyPath)) {
      try {
        mergeConfig(config, JSON.parse(fs.readFileSync(legacyPath, 'utf-8')));
      } catch {
        console.warn(`  Warning: Could not load config from ${legacyPath}`);
      }
    }
  }

  // 5. Env
  mergeConfig(config, loadFromEnv());

  return config;
}

// ── Save ──────────────────────────────────────────────────────────────────────

export function saveConfig(config: Partial<SophosConfig>, configPath: string): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Merge with existing file so we only overwrite provided keys
  let existing: any = {};
  if (fs.existsSync(configPath)) {
    try { existing = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { /* */ }
  }
  mergeConfig(existing, config);
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');
}

export function saveGlobalConfig(config: Partial<SophosConfig>): void {
  saveConfig(config, getGlobalConfigPath());
}

export function saveLocalConfig(config: Partial<SophosConfig>, dir = process.cwd()): void {
  const projectPath = getProjectConfigPath(dir);
  const dir2 = path.dirname(projectPath);
  if (!fs.existsSync(dir2)) fs.mkdirSync(dir2, { recursive: true });
  saveConfig(config, projectPath);
}

// ── Internals ─────────────────────────────────────────────────────────────────

function loadFromEnv(): Partial<SophosConfig> {
  const config: any = { ollama: {} };
  let hasOllama = false;

  const set = (key: string, val: string) => {
    config.ollama[key] = val;
    hasOllama = true;
  };

  if (process.env.SOPHOS_OLLAMA_URL)   set('base_url',    process.env.SOPHOS_OLLAMA_URL);
  if (process.env.SOPHOS_MODEL_SMALL)  set('model_small',  process.env.SOPHOS_MODEL_SMALL);
  if (process.env.SOPHOS_MODEL_MEDIUM) set('model_medium', process.env.SOPHOS_MODEL_MEDIUM);
  if (process.env.SOPHOS_MODEL_LARGE)  set('model_large',  process.env.SOPHOS_MODEL_LARGE);
  if (process.env.SOPHOS_MODEL_CODER)  set('model_coder',  process.env.SOPHOS_MODEL_CODER);
  if (process.env.SOPHOS_MODEL_PLANNER) set('model_planner', process.env.SOPHOS_MODEL_PLANNER);
  if (process.env.SOPHOS_MODEL_EXECUTOR) set('model_executor', process.env.SOPHOS_MODEL_EXECUTOR);
  if (process.env.SOPHOS_MODEL_CHAT)  set('model_chat',   process.env.SOPHOS_MODEL_CHAT);
  if (process.env.SOPHOS_TEMPERATURE)  set('temperature',  String(parseFloat(process.env.SOPHOS_TEMPERATURE)));
  if (process.env.SOPHOS_NUM_CTX)      set('num_ctx',      String(parseInt(process.env.SOPHOS_NUM_CTX)));

  return hasOllama ? config : {};
}

function mergeConfig(base: any, override: any): void {
  for (const key of Object.keys(override ?? {})) {
    if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      if (!base[key] || typeof base[key] !== 'object') base[key] = {};
      mergeConfig(base[key], override[key]);
    } else if (override[key] !== undefined) {
      base[key] = override[key];
    }
  }
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
