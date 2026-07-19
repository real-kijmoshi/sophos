// ── Intent Parser + Autocomplete ──────────────────────────────────────────────

export type IntentType =
  | 'pipeline' | 'view' | 'explain' | 'rollback'
  | 'model' | 'git' | 'help' | 'exit' | 'command';

export interface ModelOverride { model: string; phase?: string; }

export interface ParsedIntent {
  type:             IntentType;
  confidence:       number;
  raw:              string;
  pipelineRequest?: string;
  planOnly?:        boolean;
  viewTarget?:      string;
  gitOp?:           'rollback'|'commit'|'push'|'branch'|'stash'|'log'|'diff';
  modelOverride?:   ModelOverride;
  explainTarget?:   string;
  command?:         string;
  commandArgs?:     string[];
}

// ── Autocomplete tree ─────────────────────────────────────────────────────────
// Maps every slash command to its valid subcommands/args for Tab completion.
export const COMMAND_COMPLETIONS: Record<string, string[]> = {
  '/models':       ['assign', 'coder', 'planner', 'executor', 'chat', 'scanner', 'architect', 'base', 'small', 'large', 'set', 'suggest', 'save', 'list', 'wizard', 'install', 'offline'],
  '/models save':  ['local', 'global'],
  '/git':          ['status', 'log', 'diff', 'commit', 'branch', 'stash'],
  '/git stash':    ['pop'],
  '/plan':         ['on', 'off'],
  '/auto-compact': ['on', 'off'],
  '/stream':       ['on', 'off'],
  '/todo':         ['add', 'list', 'done', 'clear'],
  '/help':         [
    'models', 'git', 'diff', 'plan', 'security', 'cost',
    'rollback', 'config', 'compact', 'clear', 'exit', 'status', 'hw',
  ],
  '/notifications': ['clear'],
  '/config':        ['init'],
  '/tunnel':        ['cloudflared', 'localtunnel', 'ngrok', 'auto'],
};

// All top-level slash commands with their description (for hint display)
export const ALL_COMMANDS: Array<{ name: string; desc: string; aliases?: string[] }> = [
  { name: '/agent',         desc: 'fast agent — read/edit/run, no pipeline' },
  { name: '/pipeline',      desc: 'force the full 9-phase pipeline',    aliases: ['/pipe'] },
  { name: '/models',        desc: 'model status + tier assignments',   aliases: ['/model', '/m'] },
  { name: '/diff',          desc: 'colored git diff',                  aliases: ['/d'] },
  { name: '/git',           desc: 'git operations',                    aliases: ['/g'] },
  { name: '/plan',          desc: 'toggle plan-only mode' },
  { name: '/security',      desc: 'last security scan',                aliases: ['/sec'] },
  { name: '/cost',          desc: 'token usage' },
  { name: '/rollback',      desc: 'stash + revert' },
  { name: '/config',        desc: 'project config',                     aliases: [] },
  { name: '/config-init',   desc: 'initialize .sophos/',                aliases: [] },
  { name: '/status',        desc: 'project status',                     aliases: ['/st'] },
  { name: '/compact',       desc: 'compress conversation context',     aliases: ['/c'] },
  { name: '/clear',         desc: 'clear screen',                      aliases: ['/cls'] },
  { name: '/inspect',       desc: 'view file or directory',            aliases: ['/i'] },
  { name: '/todo',          desc: 'task list' },
  { name: '/agents',        desc: 'agent roster' },
  { name: '/tasks',         desc: 'task queue' },
  { name: '/notifications', desc: 'notification tray',                 aliases: ['/notif', '/n'] },
  { name: '/sessions',      desc: 'saved sessions' },
  { name: '/export',        desc: 'export session' },
  { name: '/stream',        desc: 'toggle streaming' },
  { name: '/auto-compact',  desc: 'toggle auto-compact',               aliases: ['/ac'] },
  { name: '/permissions',   desc: 'permission rules',                  aliases: ['/perm'] },
  { name: '/resume',        desc: 'resume last pipeline',              aliases: ['/r'] },
  { name: '/webui',         desc: 'start WebUI server' },
  { name: '/mcp',           desc: 'start MCP server' },
  { name: '/tunnel',        desc: 'expose port via tunnel' },
  { name: '/hw',            desc: 'hardware diagnostics',                aliases: ['/hardware', '/gpu'] },
  { name: '/help',          desc: 'show commands',                     aliases: ['/h', '/?'] },
  { name: '/exit',          desc: 'quit',                              aliases: ['/quit', '/q'] },
];

// ── Complete function ─────────────────────────────────────────────────────────
// Returns [completions, originalLine] — drop-in replacement for readline completer.
export function complete(line: string, recentIntents: string[] = []): [string[], string] {
  const trimmed = line.trimStart();

  // ── Slash command completions ──────────────────────────────────────────────
  if (trimmed.startsWith('/') || trimmed === '') {
    // Sort entries longest-key-first so "/models save" matches before "/models"
    const entries = Object.entries(COMMAND_COMPLETIONS)
      .sort((a, b) => b[0].length - a[0].length);

    // Multi-word subcommand completion (e.g. "/models save l" or "/git stash ")
    for (const [prefix, subs] of entries) {
      if (trimmed.startsWith(prefix + ' ')) {
        const after = trimmed.slice(prefix.length + 1);
        const hits  = subs.filter(s => s.startsWith(after));
        return [(hits.length ? hits : subs).map(s => prefix + ' ' + s), line];
      }
    }

    // Single-word subcommands (e.g. "/models s")
    const parts   = trimmed.split(/\s+/);
    const cmdPart = parts[0];
    const argPart = parts.slice(1).join(' ');

    if (parts.length >= 2 && COMMAND_COMPLETIONS[cmdPart]) {
      const subs = COMMAND_COMPLETIONS[cmdPart];
      const hits = subs.filter(s => s.startsWith(argPart));
      return [(hits.length ? hits : subs).map(s => cmdPart + ' ' + s), line];
    }

    // Top-level command completion
    const allNames = ALL_COMMANDS.flatMap(cmd => [cmd.name, ...(cmd.aliases ?? [])]);
    const hits     = allNames.filter(n => n.startsWith(trimmed));
    return [hits.length ? hits : ALL_COMMANDS.map(c => c.name), line];
  }

  // ── Natural language completions ───────────────────────────────────────────
  return [generateSuggestions(trimmed, recentIntents), line];
}

// ── NL Suggestions ────────────────────────────────────────────────────────────
const NL_COMPLETIONS: Record<string, string[]> = {
  'add ':        ['add user authentication', 'add JWT auth with refresh tokens', 'add rate limiting', 'add unit tests', 'add Docker support', 'add CI/CD pipeline'],
  'fix ':        ['fix the build error', 'fix the type errors', 'fix the failing tests', 'fix the security vulnerability'],
  'refactor ':   ['refactor the auth module', 'refactor database queries', 'refactor API handlers', 'refactor error handling'],
  'create ':     ['create a REST API endpoint', 'create database migration', 'create unit tests for', 'create Docker configuration'],
  'implement ':  ['implement pagination', 'implement caching layer', 'implement rate limiting', 'implement WebSocket support'],
  'write ':      ['write unit tests for', 'write integration tests', 'write API documentation'],
  'migrate ':    ['migrate database schema', 'migrate to TypeScript', 'migrate to new API version'],
  'show ':       ['show me the auth middleware', 'show me the database schema', 'show me the API routes', 'show the error logs'],
  'why ':        ['why is this slow?', 'why is the build failing?', 'why are the tests failing?'],
  'explain ':    ['explain the auth flow', 'explain the database schema', 'explain the error'],
  'optimize ':   ['optimize database queries', 'optimize bundle size', 'optimize API performance'],
  'debug ':      ['debug the authentication issue', 'debug the memory leak', 'debug the race condition'],
};

// ── Repo context for smarter suggestions ─────────────────────────────────────
export interface SuggestionContext {
  languages?:   string[];
  frameworks?:  string[];
  hasAuth?:      boolean;
  hasTests?:     boolean;
  hasDocker?:    boolean;
  hasCI?:        boolean;
  recentFiles?:  string[];
  branch?:       string;
  dirty?:        boolean;
}

const LANG_SUGGESTIONS: Record<string, string[]> = {
  'typescript': ['add type guards', 'add strict TypeScript config', 'migrate to TypeScript'],
  'javascript': ['migrate to TypeScript', 'add ESLint', 'add Prettier'],
  'python':     ['add type hints', 'add pytest tests', 'add mypy config'],
  'rust':       ['add error handling with thiserror', 'add benchmarks', 'add clippy lints'],
  'go':         ['add error wrapping', 'add benchmarks', 'add go vet checks'],
};

const FRAMEWORK_SUGGESTIONS: Record<string, string[]> = {
  'next':       ['add SSR route', 'add API route', 'add middleware'],
  'express':    ['add rate limiting', 'add helmet security', 'add CORS config'],
  'fastapi':    ['add dependency injection', 'add background tasks', 'add OpenAPI docs'],
  'django':     ['add REST endpoint', 'add celery task', 'add Django signals'],
};

export function generateSuggestions(
  partial: string,
  recentIntents: string[] = [],
  ctx?: SuggestionContext,
): string[] {
  if (!partial) {
    const recent = recentIntents.slice(-3).filter(Boolean);
    if (recent.length) return recent;

    // Context-aware default suggestions
    if (ctx) {
      const contextSuggestions: string[] = [];
      if (!ctx.hasAuth)  contextSuggestions.push('add user authentication');
      if (!ctx.hasTests) contextSuggestions.push('add unit tests');
      if (!ctx.hasDocker && ctx.languages?.includes('typescript')) contextSuggestions.push('add Docker support');
      if (contextSuggestions.length) return contextSuggestions.slice(0, 4);
    }

    return [
      'add user authentication',
      'refactor the database layer',
      'add unit tests',
      'fix the build error',
    ];
  }

  const lower = partial.toLowerCase();

  // Exact prefix match in NL_COMPLETIONS
  for (const [prefix, completions] of Object.entries(NL_COMPLETIONS)) {
    if (lower.startsWith(prefix.trimEnd())) {
      const after = partial.slice(prefix.trimEnd().length).trim();
      if (!after) return completions;
      return completions.filter(c => c.toLowerCase().includes(after.toLowerCase()));
    }
  }

  // Prefix match on first word
  const firstWord = lower.split(' ')[0];
  for (const [prefix, completions] of Object.entries(NL_COMPLETIONS)) {
    if (prefix.trimEnd().startsWith(firstWord)) {
      return completions.slice(0, 4);
    }
  }

  // Context-aware suggestions based on detected stack
  if (ctx) {
    const ctxSuggestions: string[] = [];
    for (const lang of (ctx.languages ?? [])) {
      const suggestions = LANG_SUGGESTIONS[lang.toLowerCase()];
      if (suggestions) ctxSuggestions.push(...suggestions);
    }
    for (const fw of (ctx.frameworks ?? [])) {
      const suggestions = FRAMEWORK_SUGGESTIONS[fw.toLowerCase()];
      if (suggestions) ctxSuggestions.push(...suggestions);
    }
    if (ctxSuggestions.length) return ctxSuggestions.slice(0, 4);
  }

  return [];
}

// ── Intent parser ─────────────────────────────────────────────────────────────
const PIPELINE_VERBS = [
  'add','implement','create','build','write','generate','make','set up','setup',
  'integrate','refactor','fix','update','upgrade','migrate','optimize','remove',
  'delete','replace','connect','deploy','patch',
];

const VIEW_VERBS    = ['show','view','open','read','display','list','print','cat','see','inspect','find'];
const EXPLAIN_VERBS = ['why','explain','debug','what is','what does','how does','analyse','analyze','diagnose'];
const ROLLBACK_VERBS= ['revert','rollback','roll back','undo','restore'];
const GIT_VERBS     = ['commit','push','pull','branch','checkout','merge','stash','git log','git status','git diff'];

const TASK_WORDS = [
  'auth','api','endpoint','service','test','module','component','database','schema',
  'migration','middleware','route','hook','function','class','interface','type',
  'model','controller','jwt','oauth','cache','queue','worker','cron',
];

export function parseIntent(input: string): ParsedIntent {
  const raw   = input.trim();
  const lower = raw.toLowerCase();

  if (raw.startsWith('/')) {
    const parts = raw.slice(1).split(/\s+/);
    return { type: 'command', confidence: 1, raw, command: parts[0], commandArgs: parts.slice(1) };
  }

  if (!lower) return { type: 'help', confidence: 0.5, raw };
  if (/^(exit|quit|bye|goodbye|:q|q!)$/i.test(lower)) return { type: 'exit', confidence: 1, raw };
  if (/^(help|\?|\/help)$/i.test(lower)) return { type: 'help', confidence: 1, raw };

  const modelMatch = raw.match(/use\s+(\S+)\s+(?:model\s+)?(?:for\s+(.+))?/i);
  if (modelMatch) return { type: 'model', confidence: 0.9, raw, modelOverride: { model: modelMatch[1], phase: modelMatch[2]?.trim() } };

  if (startsWithAny(lower, ROLLBACK_VERBS)) return { type: 'rollback', confidence: 0.95, raw, gitOp: 'rollback' };

  const gitOp = detectGitOp(lower);
  if (gitOp) return { type: 'git', confidence: 0.9, raw, gitOp };

  if (startsWithAny(lower, EXPLAIN_VERBS)) return { type: 'explain', confidence: 0.9, raw, explainTarget: raw };

  if (startsWithAny(lower, VIEW_VERBS)) {
    const verb = VIEW_VERBS.find(v => lower.startsWith(v))!;
    const target = raw.slice(verb.length).trim().replace(/^(me\s+)?the\s+/i, '').trim();
    return { type: 'view', confidence: 0.9, raw, viewTarget: target || raw };
  }

  const planOnly = /\b(plan only|just plan|dry.?run|--plan|analyse only)\b/i.test(lower);
  if (startsWithAny(lower, PIPELINE_VERBS) || TASK_WORDS.some(w => lower.includes(w))) {
    return {
      type: 'pipeline', confidence: 0.85, raw,
      pipelineRequest: raw.replace(/\s*(--plan|plan only|just plan)\s*/gi, '').trim(),
      planOnly,
    };
  }

  return { type: 'pipeline', confidence: 0.55, raw, pipelineRequest: raw, planOnly: false };
}

function startsWithAny(s: string, patterns: string[]): boolean {
  return patterns.some(p => s.startsWith(p));
}

function detectGitOp(s: string): ParsedIntent['gitOp'] | null {
  if (s.startsWith('commit'))               return 'commit';
  if (s.startsWith('push'))                 return 'push';
  if (s.startsWith('branch'))               return 'branch';
  if (s.startsWith('stash'))                return 'stash';
  if (s.includes('git log')||s.startsWith('log')) return 'log';
  if (s.includes('git diff'))               return 'diff';
  return null;
}
