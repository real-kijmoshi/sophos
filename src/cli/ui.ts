// ── SOPHOS v3.2 UI ────────────────────────────────────────────────────────────
import chalk from 'chalk';

// ── Design tokens ─────────────────────────────────────────────────────────────
export const TOKENS = {
  colors: {
    bg:            '#1e1e2e',
    surface:       '#313244',
    border:        '#45475a',
    textPrimary:   '#cdd6f4',
    textSecondary: '#a6adc8',
    accent:        '#89b4fa',
    success:       '#a6e3a1',
    warning:       '#f9e2af',
    error:         '#f38ba8',
    info:          '#89dceb',
    muted:         '#585b70',
    orange:        '#fab387',
    purple:        '#cba6f7',
    pink:          '#f5c2e7',
  },
} as const;

export const c = {
  primary:   chalk.hex(TOKENS.colors.accent),
  secondary: chalk.hex(TOKENS.colors.info),
  success:   chalk.hex(TOKENS.colors.success),
  warning:   chalk.hex(TOKENS.colors.warning),
  error:     chalk.hex(TOKENS.colors.error),
  info:      chalk.hex(TOKENS.colors.info),
  muted:     chalk.hex(TOKENS.colors.textSecondary),
  dim:       chalk.hex(TOKENS.colors.muted),
  orange:    chalk.hex(TOKENS.colors.orange),
  purple:    chalk.hex(TOKENS.colors.purple),
  pink:      chalk.hex(TOKENS.colors.pink),
  text:      chalk.hex(TOKENS.colors.textPrimary),
  border:    chalk.hex(TOKENS.colors.border),
  accent:    chalk.hex(TOKENS.colors.accent),
  bold:      chalk.bold,
};

export const W = (): number => Math.min(process.stdout.columns || 80, 100);

export const ANSI = {
  hideCursor:  '\x1B[?25l',
  showCursor:  '\x1B[?25h',
  clearScreen: '\x1Bc',
  eraseDown:   '\x1B[0J',
  up:          (n: number) => `\x1B[${n}A`,
  clearLine:   '\r\x1B[2K',
};

export const STATUS = {
  pending: c.dim('○'),
  running: c.warning('◐'),
  passed:  c.success('●'),
  failed:  c.error('●'),
  skipped: c.muted('─'),
} as const;

export const TASK_STATUS = {
  queue:  c.dim('○'),
  active: c.warning('◐'),
  done:   c.success('●'),
  failed: c.error('●'),
  repair: c.orange('◑'),
} as const;

// ── Utilities (defined early — used by everything below) ──────────────────────
export function vLen(s: string): number {
  return s.replace(/\x1B\[[0-9;]*[mK]/g, '').length;
}

export function formatDuration(ms: number): string {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function center(text: string, width: number): string {
  const padding = Math.max(0, Math.floor((width - vLen(text)) / 2));
  return ' '.repeat(padding) + text;
}

export function wordWrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const result: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + word).length > width && line) {
      result.push(line.trimEnd());
      line = '';
    }
    line += word + ' ';
  }
  if (line.trim()) result.push(line.trimEnd());
  return result;
}

// ── Rounded panel helpers ─────────────────────────────────────────────────────
// Building blocks for the modern boxed chrome (input box, palette dropdown).
// `width` is the total visible width including both border characters.
type Paint = (s: string) => string;

export function panelTop(width: number, title?: string, paint: Paint = c.border): string {
  const inner = Math.max(2, width - 2);
  if (!title) return paint('╭' + '─'.repeat(inner) + '╮');
  const label = ` ${title} `;
  const fill  = Math.max(0, inner - vLen(label) - 2);
  return paint('╭─') + label + paint('─'.repeat(fill + 1) + '╮');
}

export function panelRow(content: string, width: number, paint: Paint = c.border): string {
  const inner = Math.max(2, width - 2);
  const pad   = Math.max(0, inner - vLen(content) - 1);
  return paint('│') + ' ' + truncPanel(content, inner - 1) + ' '.repeat(pad) + paint('│');
}

export function panelBottom(width: number, right?: string, paint: Paint = c.border): string {
  const inner = Math.max(2, width - 2);
  if (!right) return paint('╰' + '─'.repeat(inner) + '╯');
  const label = ` ${right} `;
  const fill  = Math.max(0, inner - vLen(label) - 1);
  return paint('╰' + '─'.repeat(fill)) + label + paint('─╯');
}

function truncPanel(s: string, max: number): string {
  if (vLen(s) <= max) return s;
  let visible = 0, out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\x1B') {
      const m = /^\x1B\[[0-9;]*[A-Za-z]/.exec(s.slice(i));
      if (m) { out += m[0]; i += m[0].length; continue; }
    }
    if (visible >= max - 1) break;
    out += s[i]; visible++; i++;
  }
  return out + '\x1B[0m' + '…';
}

// ── ASCII art logo ─────────────────────────────────────────────────────────────
// Rendered only on first launch. Compact, high-impact, 6 lines tall.
const LOGO_LINES = [
  '  ███████╗ ██████╗ ██████╗ ██╗  ██╗ ██████╗ ███████╗',
  '  ██╔════╝██╔═══██╗██╔══██╗██║  ██║██╔═══██╗██╔════╝',
  '  ███████╗██║   ██║██████╔╝███████║██║   ██║███████╗ ',
  '  ╚════██║██║   ██║██╔═══╝ ██╔══██║██║   ██║╚════██║ ',
  '  ███████║╚██████╔╝██║     ██║  ██║╚██████╔╝███████║ ',
  '  ╚══════╝ ╚═════╝ ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝ ',
];

// Smaller logo for narrower terminals (<= 72 cols)
const LOGO_SMALL = [
  ' ┌─┐┌─┐┌─┐┬ ┬┌─┐┌─┐',
  ' └─┐│ │├─┘├─┤│ │└─┐',
  ' └─┘└─┘┴  ┴ ┴└─┘└─┘',
];

// ── Gradient / shimmer helpers ────────────────────────────────────────────────
// Per-character color interpolation — the signature “frontier CLI” look.

function hexLerp(from: string, to: string, t: number): string {
  const f = parseInt(from.slice(1), 16);
  const g = parseInt(to.slice(1), 16);
  const ch = (shift: number) => {
    const a = (f >> shift) & 0xff;
    const b = (g >> shift) & 0xff;
    return Math.round(a + (b - a) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Colors `text` with a left→right gradient between two hex colors. */
export function gradientText(text: string, from: string, to: string): string {
  const chars = [...text];
  const n     = Math.max(1, chars.length - 1);
  return chars
    .map((ch, i) => ch === ' ' ? ch : chalk.hex(hexLerp(from, to, i / n))(ch))
    .join('');
}

/**
 * Animated shimmer: a bright band sweeps across dim text.
 * Call with an increasing frame counter (one step per render tick).
 */
export function shimmerText(text: string, frame: number): string {
  const chars = [...text];
  const span  = chars.length + 8;
  const pos   = frame % span;
  return chars.map((ch, i) => {
    if (ch === ' ') return ch;
    const d = Math.abs(i - pos);
    if (d === 0)     return chalk.hex(TOKENS.colors.textPrimary)(ch);
    if (d === 1)     return chalk.hex(TOKENS.colors.accent)(ch);
    if (d === 2)     return chalk.hex(TOKENS.colors.purple)(ch);
    return chalk.hex(TOKENS.colors.muted)(ch);
  }).join('');
}

export function asciiLogo(opts?: { small?: boolean }): string {
  const w = W();
  const lines = (opts?.small || w < 72) ? LOGO_SMALL : LOGO_LINES;
  return lines
    .map(l => gradientText(l, TOKENS.colors.accent, TOKENS.colors.purple))
    .join('\n');
}

// ── Welcome card ──────────────────────────────────────────────────────────────
// Full startup screen shown on first launch.
export function welcomeCard(ctx: {
  projectName: string;
  projectDir:  string;
  branch?:     string;
  dirty?:      boolean;
  fileCount?:  number;
  ollamaOnline: boolean;
  model?:      string;
  version?:    string;
}): string {
  const w     = W();
  const lines: string[] = [];

  lines.push('');
  lines.push(asciiLogo({ small: w < 72 }));
  lines.push('');

  // Rounded info box, Claude Code style
  const bw  = Math.min(w - 4, 60);
  const top = `  ${c.dim('╭' + '─'.repeat(bw) + '╮')}`;
  const bot = `  ${c.dim('╰' + '─'.repeat(bw) + '╯')}`;
  const row = (content: string) => {
    const pad = Math.max(0, bw - vLen(content) - 2);
    return `  ${c.dim('│')} ${content}${' '.repeat(pad)} ${c.dim('│')}`;
  };
  const clip = (s: string, max: number) => s.length > max ? '…' + s.slice(-(max - 1)) : s;

  const ver     = ctx.version ?? 'v3.2';
  const home    = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const dirStr  = clip(home ? ctx.projectDir.replace(home, '~') : ctx.projectDir, bw - 14);
  const dot     = ctx.ollamaOnline ? c.success('●') : c.error('●');
  const modelStr = ctx.ollamaOnline
    ? (ctx.model ? c.text(ctx.model) : c.warning('no model — /models'))
    : c.error('ollama offline');
  const branchStr = ctx.branch
    ? (ctx.dirty ? c.warning(`⎇ ${ctx.branch}*`) : c.text(`⎇ ${ctx.branch}`))
    : c.dim('not a git repo');

  lines.push(top);
  lines.push(row(`${gradientText('◆ sophos', TOKENS.colors.accent, TOKENS.colors.purple)} ${c.dim(ver)}  ${c.muted('multi-agent orchestrator')}`));
  lines.push(row(''));
  lines.push(row(`${c.dim('project')}  ${c.accent.bold(ctx.projectName)}  ${c.dim(dirStr)}`));
  lines.push(row(`${c.dim('model')}    ${dot} ${modelStr}`));
  lines.push(row(`${c.dim('git')}      ${branchStr}`));
  lines.push(bot);

  lines.push('');
  lines.push(`  ${c.dim('›')} ${c.muted('describe what you want to build, then press')} ${c.text('↵')}`);
  lines.push(`  ${c.dim('›')} ${c.primary('/')} ${c.muted('for commands')} ${c.dim('·')} ${c.muted('tab to complete')} ${c.dim('·')} ${c.muted('ctrl+c twice to quit')}`);
  lines.push('');

  return lines.join('\n');
}

// ── Compact one-line banner (used after /clear or in batch mode) ──────────────
export function banner(ctx?: {
  projectName?: string;
  fileCount?:   number;
  branch?:      string;
  dirty?:       boolean;
}): string {
  const w    = W();
  const logo = c.primary.bold('◆ SOPHOS') + c.dim(' v3.0');

  const rightParts: string[] = [];
  if (ctx?.projectName) rightParts.push(c.muted(ctx.projectName));
  if (ctx?.branch) {
    rightParts.push(ctx.dirty ? c.warning('⎇ ' + ctx.branch + '*') : c.dim('⎇ ' + ctx.branch));
  }
  if (ctx?.fileCount !== undefined) rightParts.push(c.dim(`${ctx.fileCount} files`));

  const rightStr = rightParts.join(c.dim('  '));
  const gap      = rightStr ? Math.max(2, w - vLen(logo) - vLen(rightStr) - 2) : 0;

  return rightStr ? `${logo}${' '.repeat(gap)}${rightStr}\n` : `${logo}\n`;
}

// ── Status bar ────────────────────────────────────────────────────────────────
export function statusBar(opts: {
  connected:     boolean;
  latencyMs?:    number;
  activeAgents?: number;
  queuedTasks?:  number;
  model?:        string;
  planMode?:     boolean;
  tokens?:       number;
  branch?:       string;
  dirty?:        boolean;
}): string {
  const dot    = opts.connected ? c.success('●') : c.error('●');
  const model  = opts.model
    ? c.dim(opts.model.length > 26 ? opts.model.slice(0, 24) + '…' : opts.model)
    : c.warning('no model');
  const plan   = opts.planMode ? c.warning('plan') : '';
  const tokens = opts.tokens   ? c.dim(`${fmtNum(opts.tokens)} tok`) : '';
  const branch = opts.branch
    ? (opts.dirty ? c.warning('⎇ ' + opts.branch + '*') : c.dim('⎇ ' + opts.branch))
    : '';
  const latency = opts.latencyMs !== undefined ? c.dim(`${opts.latencyMs}ms`) : '';

  const left  = [c.primary.bold('SOPHOS'), dot, model, plan].filter(Boolean).join(' ');
  const right = [tokens, branch, latency].filter(Boolean).join(c.dim('  '));

  const w       = W();
  const gap     = Math.max(1, w - vLen(left) - vLen(right) - 4);
  const bar     = `  ${left}${' '.repeat(gap)}${right}`;
  return c.dim('─'.repeat(w)) + '\n' + bar + '\n' + c.dim('─'.repeat(w));
}


// ── Input status line ─────────────────────────────────────────────────────────
// Single dim line rendered directly under the prompt (LineEditor below-region).
// Left: live context. Right: contextual key hint.
export function inputStatusLine(opts: {
  online:    boolean;
  model?:    string;
  branch?:   string;
  dirty?:    boolean;
  planMode?: boolean;
  tokens?:   number;
  hint?:     string;
}): string {
  const parts: string[] = [];
  const dot = opts.online ? c.success('●') : c.error('●');
  const model = opts.model
    ? (opts.model.length > 24 ? opts.model.slice(0, 22) + '…' : opts.model)
    : 'no model';
  parts.push(`${dot} ${c.dim(model)}`);
  if (opts.branch) {
    parts.push(opts.dirty ? c.warning(`⎇ ${opts.branch}*`) : c.dim(`⎇ ${opts.branch}`));
  }
  if (opts.planMode) parts.push(c.warning('plan'));
  if (opts.tokens)   parts.push(c.dim(`${fmtNum(opts.tokens)} tok`));

  const left  = parts.join(c.dim('  ·  '));
  const right = c.dim(opts.hint ?? '/ commands · tab complete');
  const w     = Math.min(process.stdout.columns || 80, 100);
  const gap   = Math.max(2, w - vLen(left) - vLen(right) - 4);
  return `  ${left}${' '.repeat(gap)}${right}`;
}

// ── Phase dots ────────────────────────────────────────────────────────────────
// Nine-dot mini-map of the pipeline: ● done  ◐ running  ● failed  ○ pending
export function phaseDots(statuses: PhaseCardStatus[]): string {
  return statuses.map(s =>
    s === 'passed'  ? c.success('●') :
    s === 'failed'  ? c.error('●')   :
    s === 'running' ? c.warning('◐') :
    s === 'skipped' ? c.muted('─')   : c.dim('○')
  ).join(' ');
}

// ── Phase card ────────────────────────────────────────────────────────────────
export type PhaseCardStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface PhaseCardOpts {
  number:      number;
  name:        string;
  status:      PhaseCardStatus;
  lines?:      string[];
  collapsed?:  boolean;
  durationMs?: number;
  aborted?:    boolean;
}

export function phaseCard(opts: PhaseCardOpts): string {
  const w       = W() - 4;
  const icon    = opts.aborted
    ? c.orange('◌')
    : STATUS[opts.status] ?? STATUS.pending;
  const dur     = opts.durationMs !== undefined ? c.dim(` ${formatDuration(opts.durationMs)}`) : '';
  const numStr  = c.dim(String(opts.number).padStart(2));

  if (opts.status === 'pending') {
    return `  ${icon} ${numStr}  ${c.dim(opts.name)}`;
  }

  const chevron   = opts.collapsed ? c.dim('›') : c.dim('∨');
  const nameColor =
    opts.aborted  ? c.orange :
    opts.status === 'passed'  ? c.success :
    opts.status === 'failed'  ? c.error   :
    opts.status === 'running' ? c.warning : c.dim;

  const statusTag = opts.aborted ? c.orange(' aborted') : '';
  const headerText = `  ${icon} ${numStr}  ${nameColor(opts.name)}${statusTag}${dur}`;
  const headerPad  = Math.max(0, w + 4 - vLen(headerText) - 3);
  const header     = headerText + ' '.repeat(headerPad) + chevron;

  if (opts.collapsed || !opts.lines?.length) return header;

  const indent = '       ';
  const body   = opts.lines.slice(-8).map(l =>
    indent + lineColor(l.slice(0, w - indent.length))
  ).join('\n');

  return header + '\n' + body;
}

// ── Minimal phase line (Claude Code style) ────────────────────────────────────
// Single-line phase status for completed phases — compact, information-dense.
export function phaseLine(opts: {
  number:     number;
  name:       string;
  status:     PhaseCardStatus;
  durationMs?: number;
  aborted?:   boolean;
}): string {
  const icon = opts.aborted ? c.orange('◌')
    : opts.status === 'passed'  ? c.success('✓')
    : opts.status === 'failed'  ? c.error('✗')
    : opts.status === 'running' ? c.warning('▸')
    : c.dim('○');

  const nameColor = opts.aborted  ? c.orange
    : opts.status === 'passed'  ? c.success
    : opts.status === 'failed'  ? c.error
    : opts.status === 'running' ? c.warning : c.dim;

  const dur = opts.durationMs !== undefined ? c.dim(` ${formatDuration(opts.durationMs)}`) : '';
  const num = c.dim(String(opts.number));

  return `  ${icon} ${num}  ${nameColor(opts.name)}${dur}`;
}

// ── Streaming output (Claude Code style inline tokens) ────────────────────────
// Renders live LLM token output with a typing cursor effect.
export function streamingOutput(opts: {
  text:       string;
  agent?:     string;
  tokenCount?: number;
  elapsedMs?: number;
}): string {
  const w = W() - 8;
  const lines: string[] = [];

  // Agent label
  if (opts.agent) {
    lines.push(`  ${c.dim('├')} ${c.accent(opts.agent)}`);
  }

  // Token stream — last 4 lines, word-wrapped
  const streamLines = opts.text.split('\n').slice(-4);
  for (const sl of streamLines) {
    if (sl.trim()) {
      const truncated = sl.length > w ? sl.slice(0, w - 1) + '…' : sl;
      lines.push(`  ${c.dim('│')} ${c.text(truncated)}`);
    }
  }

  // Status line
  const parts: string[] = [];
  if (opts.tokenCount && opts.tokenCount > 0) {
    parts.push(c.dim(`${fmtNum(opts.tokenCount)} tok`));
  }
  if (opts.elapsedMs) {
    parts.push(c.dim(formatDuration(opts.elapsedMs)));
  }
  if (parts.length) {
    lines.push(`  ${c.dim('└')} ${parts.join(c.dim('  '))}`);
  }

  return lines.join('\n');
}

// ── Tool call card (expandable agent invocation) ──────────────────────────────
// Shows a single tool/agent invocation with timing and expand/collapse.
export function toolCallCard(opts: {
  name:       string;
  status:     'running' | 'done' | 'failed';
  detail?:    string;
  durationMs?: number;
  collapsed?: boolean;
}): string {
  const w = W() - 4;
  const icon = opts.status === 'running' ? c.warning('▸')
    : opts.status === 'done'   ? c.success('✓')
    : c.error('✗');

  const nameColor = opts.status === 'running' ? c.warning
    : opts.status === 'done'   ? c.success : c.error;

  const dur = opts.durationMs !== undefined ? c.dim(` ${formatDuration(opts.durationMs)}`) : '';
  const chevron = opts.collapsed !== false ? c.dim('›') : c.dim('∨');

  const header = `  ${icon} ${nameColor(opts.name)}${dur}`;
  const pad = Math.max(0, w - vLen(header) - 2);

  if (opts.collapsed !== false || !opts.detail) {
    return header + ' '.repeat(pad) + chevron;
  }

  const detailLines = opts.detail.split('\n').slice(-6).map(l =>
    `       ${c.muted(l.slice(0, w - 7))}`
  ).join('\n');

  return header + '\n' + detailLines;
}

// ── Pipeline tree ─────────────────────────────────────────────────────────────
// Shows all 9 phases as a visual tree with connector lines.
// This is the "you can see everything coming" view — renders once before pipeline starts.
export function pipelineTree(phases: Array<{
  number:     number;
  name:       string;
  status:     PhaseCardStatus;
  durationMs?: number;
}>): string {
  const lines: string[] = [];
  const total = phases.length;

  for (let i = 0; i < total; i++) {
    const p       = phases[i];
    const isLast  = i === total - 1;
    const icon    = STATUS[p.status] ?? STATUS.pending;
    const dur     = p.durationMs !== undefined ? c.dim(` ${formatDuration(p.durationMs)}`) : '';

    const nameColor =
      p.status === 'passed'  ? c.success :
      p.status === 'failed'  ? c.error   :
      p.status === 'running' ? c.warning : c.dim;

    const connector = isLast ? c.dim('  └──') : c.dim('  ├──');
    const numStr    = c.dim(String(p.number).padStart(2));

    lines.push(`${connector} ${icon} ${numStr}  ${nameColor(p.name)}${dur}`);

    if (!isLast) {
      lines.push(c.dim('  │'));
    }
  }

  return lines.join('\n');
}

// ── Live task grid ─────────────────────────────────────────────────────────────
export interface TaskRow {
  id:          string;
  description: string;
  status:      'queue' | 'active' | 'done' | 'failed' | 'repair';
  reviewers?:  string;
}

export function taskGrid(tasks: TaskRow[]): string {
  if (!tasks.length) return '';
  const w     = W() - 4;
  const idW   = 10;
  const revW  = 12;
  const stW   = 8;
  const descW = Math.max(20, w - idW - stW - revW - 8);

  const hdr = '  ' + [
    c.dim('Task'.padEnd(idW)),
    '  ',
    c.dim('Description'.padEnd(descW)),
    '  ',
    c.dim('Status'.padEnd(stW)),
    '  ',
    c.dim('Review'.padEnd(revW)),
  ].join('');

  const sep  = '  ' + c.dim('─'.repeat(w - 2));
  const rows = tasks.map(t => {
    const icon  = TASK_STATUS[t.status];
    const stLbl =
      t.status === 'queue'  ? c.dim('queued')        :
      t.status === 'active' ? c.warning('active')    :
      t.status === 'done'   ? c.success('done')      :
      t.status === 'failed' ? c.error('failed')      :
      c.orange('repair');

    return '  ' + [
      c.accent(t.id.padEnd(idW).slice(0, idW)),
      '  ',
      c.text(t.description.padEnd(descW).slice(0, descW)),
      '  ',
      `${icon} ${stLbl}`.padEnd(stW + 4).slice(0, stW + 4),
      '  ',
      c.dim((t.reviewers || '—').padEnd(revW).slice(0, revW)),
    ].join('');
  });

  return [hdr, sep, ...rows].join('\n');
}

// ── Progress bar ──────────────────────────────────────────────────────────────
export function progressBar(current: number, total: number, label = '', width = 24): string {
  const pct    = total > 0 ? current / total : 0;
  const filled = Math.floor(pct * width);
  const bar    = c.success('█'.repeat(filled)) + c.dim('░'.repeat(width - filled));
  return `${bar} ${c.dim(Math.floor(pct * 100) + '%')}  ${c.dim(label)}`;
}

// ── Diff card ─────────────────────────────────────────────────────────────────
export function diffCard(taskId: string, fileSummary: string, lines: string[], maxLines = 20): string {
  const w      = W() - 4;
  const header = `  ${c.accent.bold(taskId)}  ${c.dim(fileSummary)}`;
  const div    = '  ' + c.dim('─'.repeat(w - 2));
  const body   = lines.slice(0, maxLines).map(l => {
    const col =
      l.startsWith('+') && !l.startsWith('+++') ? c.success(l) :
      l.startsWith('-') && !l.startsWith('---') ? c.error(l)   :
      l.startsWith('@@')                         ? c.info(l)    :
      l.startsWith('---') || l.startsWith('+++') ? c.dim(l)     :
      c.text(l);
    return '  ' + col.slice(0, w - 2);
  }).join('\n');
  return [header, div, body, div, `  ${c.dim('[d] full diff  [v] view file')}`].join('\n');
}

// ── Suggestions bar ───────────────────────────────────────────────────────────
export function suggestionsBar(suggestions: string[]): string {
  if (!suggestions.length) return '';
  const items = suggestions.slice(0, 4)
    .map(s => c.dim('"') + c.info(s) + c.dim('"'))
    .join(c.dim('  /  '));
  return `  ${c.dim('›')} ${items}`;
}

// ── Context line ──────────────────────────────────────────────────────────────
export function contextLine(ctx: {
  projectDir: string;
  branch?:    string;
  dirty?:     boolean;
  fileCount?: number;
  model?:     string;
  tokens?:    number;
}): string {
  const parts: string[] = [];
  if (ctx.branch) {
    parts.push(ctx.dirty ? c.warning('⎇ ' + ctx.branch + '*') : c.dim('⎇ ' + ctx.branch));
  }
  if (ctx.model)       parts.push(c.dim(ctx.model));
  if (ctx.fileCount)   parts.push(c.dim(`${ctx.fileCount} files`));
  if (ctx.tokens)      parts.push(c.dim(`${fmtNum(ctx.tokens)} tok`));
  return '  ' + parts.join(c.dim('  ·  '));
}


// ── Progress orbital ─────────────────────────────────────────────────────────
// Circular visual indicator showing all 9 phases at a glance.
// Completed = green ●, Active = yellow ◐ (pulsing), Pending = gray ○, Failed = red ●
export function progressOrbital(phases: Array<{ number: number; name: string; status: PhaseCardStatus }>): string {
  const w = W();
  const lines: string[] = [];

  // Phase status symbols
  const sym = (s: PhaseCardStatus) =>
    s === 'passed'  ? c.success('●') :
    s === 'failed'  ? c.error('●')   :
    s === 'running' ? c.warning('◐') :
    s === 'skipped' ? c.muted('─')   : c.dim('○');

  const total   = phases.length;
  const done    = phases.filter(p => p.status === 'passed').length;
  const failed  = phases.filter(p => p.status === 'failed').length;
  const running = phases.find(p => p.status === 'running');
  const pct     = Math.floor((done / total) * 100);

  // Build the orbital ring — arrange 9 phases in a circle
  // Using a 5×5 grid approximation with box-drawing
  const orbital: string[] = [];
  const pad = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);

  // Map phases to positions on a circle (top, right, bottom, left + corners)
  // Position indices: 0=top, 1=upper-right, 2=right, 3=lower-right,
  //                   4=bottom, 5=lower-left, 6=left, 7=upper-left, 8=center
  const positions = [
    { row: 0, col: 12, phase: 0 },  // Phase 1 — top center
    { row: 1, col: 18, phase: 1 },  // Phase 2 — upper right
    { row: 2, col: 22, phase: 2 },  // Phase 3 — right
    { row: 3, col: 18, phase: 3 },  // Phase 4 — lower right
    { row: 4, col: 12, phase: 4 },  // Phase 5 — bottom center
    { row: 3, col: 6,  phase: 5 },  // Phase 6 — lower left
    { row: 2, col: 2,  phase: 6 },  // Phase 7 — left
    { row: 1, col: 6,  phase: 7 },  // Phase 8 — upper left
    { row: 2, col: 12, phase: 8 },  // Phase 9 — center
  ];

  // Create a 5-row × 26-col grid
  const grid: string[][] = Array.from({ length: 5 }, () => Array(26).fill(' '));

  // Draw connector lines (simplified circle outline)
  // Top arc
  grid[0][8]  = '╭'; for (let i = 9; i < 16; i++) grid[0][i] = '─'; grid[0][16] = '╮';
  // Bottom arc
  grid[4][8]  = '╰'; for (let i = 9; i < 16; i++) grid[4][i] = '─'; grid[4][16] = '╯';
  // Left side
  grid[1][5] = '│'; grid[2][3] = '│'; grid[3][5] = '│';
  // Right side
  grid[1][19] = '│'; grid[2][21] = '│'; grid[3][19] = '│';
  // Horizontal connections
  grid[1][6] = '─'; grid[1][18] = '─';
  grid[2][4] = '─'; grid[2][20] = '─';
  grid[3][6] = '─'; grid[3][18] = '─';

  // Place phase indicators at their positions
  for (const pos of positions) {
    if (pos.phase < total) {
      const p = phases[pos.phase];
      const s = sym(p.status);
      // Each indicator is: ① symbol
      const numStr = String(p.number);
      grid[pos.row][pos.col]     = s;
      grid[pos.row][pos.col + 1] = numStr;
    }
  }

  // Convert grid to lines with proper coloring
  for (const row of grid) {
    orbital.push('  ' + row.join(''));
  }

  // Progress bar below the orbital
  const filled = Math.floor((done / total) * 24);
  const bar = c.success('█'.repeat(filled)) + c.dim('░'.repeat(24 - filled));

  const statusParts = [
    `${done}/${total} phases`,
    running ? c.warning(`${running.name}`) : '',
    failed  ? c.error(`${failed} failed`)  : '',
  ].filter(Boolean).join(c.dim(' · '));

  lines.push(...orbital);
  lines.push('');
  lines.push('  ' + bar + `  ${c.dim(pct + '%')}  ${c.dim(statusParts)}`);

  return lines.join('\n');
}

// ── Error helpers ─────────────────────────────────────────────────────────────
export function classifyError(message: string): string[] {
  const m = message.toLowerCase();
  if (m.includes('econnrefused') || m.includes('connection refused'))
    return ['Start Ollama: ollama serve', 'Check SOPHOS_OLLAMA_URL in .sophos.json'];
  if (m.includes('model not found') || m.includes('404'))
    return ['Pull the model: ollama pull <name>', 'Run /models to check configured names'];
  if (m.includes('timeout'))
    return ['Increase timeout_ms in .sophos.json', 'Try a smaller/faster model'];
  if (m.includes('json') || m.includes('parse'))
    return ['Model returned malformed JSON — try a larger model', 'Run /models suggest for recommendations'];
  return ['Run /models to verify model config', 'Use /clear to reset context'];
}

export interface ErrorCard {
  title:   string;
  message: string;
  phase?:  string;
  hints?:  string[];
  raw?:    string;
}

export function errorCard(err: ErrorCard): string {
  const w     = W() - 4;
  const lines: string[] = [''];
  lines.push(`  ${c.error('✗')} ${c.error.bold(err.title)}`);
  if (err.phase) lines.push(`  ${c.dim('phase:')} ${c.muted(err.phase)}`);
  lines.push('');
  for (const l of wordWrap(err.message, w - 4)) lines.push(`  ${c.muted(l)}`);
  const hints = err.hints?.length ? err.hints : classifyError(err.message);
  if (hints.length) {
    lines.push('');
    lines.push(`  ${c.warning('hints:')}`);
    for (const h of hints) lines.push(`  ${c.dim('›')} ${c.text(h)}`);
  }
  if (err.raw) {
    lines.push('');
    lines.push('  ' + c.dim('─'.repeat(Math.min(48, w - 4))));
    for (const l of err.raw.split('\n').slice(0, 5)) lines.push(`  ${c.dim(l.slice(0, w - 4))}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── SHIP IT panel ─────────────────────────────────────────────────────────────
export function shipItPanel(summary: {
  phases:     number;
  tests:      number;
  vulns:      number;
  commitMsg?: string;
  files?:     number;
  duration?:  string;
  diffStats?: { added: number; removed: number; files: number };
}): string {
  const w     = W();
  const lines: string[] = [''];
  const hr    = '  ' + c.dim('─'.repeat(w - 4));

  lines.push(hr);
  lines.push('');

  const vulnStr = summary.vulns === 0
    ? c.success('clean')
    : c.error(`${summary.vulns} vuln${summary.vulns > 1 ? 's' : ''}`);

  lines.push('  ' + c.success('✦') + '  ' + c.success.bold('Pipeline complete') + '   ' +
    [
      c.dim(`${summary.phases} phases`),
      summary.tests > 0 ? c.dim(`${summary.tests} tests`) : '',
      vulnStr,
      summary.duration ? c.dim(summary.duration) : '',
    ].filter(Boolean).join(c.dim('  ·  '))
  );

  if (summary.diffStats) {
    const { added, removed, files } = summary.diffStats;
    lines.push(`     ${c.dim('diff:')} ${c.success('+' + added)} ${c.error('-' + removed)}  ${c.dim(`across ${files} file${files !== 1 ? 's' : ''}`)}`);
  }
  if (summary.commitMsg) {
    lines.push(`     ${c.dim('commit:')} ${c.muted(summary.commitMsg.slice(0, 72))}`);
  }

  lines.push('');
  lines.push(
    `  ${c.success.bold('  ship it  ')}` +
    `   ${c.dim('type "ship it"  ·  "diff" to review  ·  "abort" to cancel')}`
  );
  lines.push('');
  lines.push(hr);
  lines.push('');
  return lines.join('\n');
}

// ── Goodbye / session summary card ────────────────────────────────────────────
export function goodbyeCard(stats: {
  sessionMs:  number;
  pipelines:  number;
  tokens:     number;
  commits:    number;
  model?:     string;
}): string {
  const w     = W();
  const lines: string[] = [''];
  const hr    = c.dim('─'.repeat(w));

  lines.push(hr);
  lines.push('');
  lines.push(center(c.primary.bold('◆ SOPHOS') + c.dim('  session complete'), w));
  lines.push('');

  const stats_row = [
    c.dim(formatDuration(stats.sessionMs)) + c.dim(' session'),
    stats.pipelines > 0 ? c.accent(String(stats.pipelines)) + c.dim(' pipeline' + (stats.pipelines !== 1 ? 's' : '')) : '',
    stats.tokens    > 0 ? c.dim(fmtNum(stats.tokens)) + c.dim(' tokens') : '',
    stats.commits   > 0 ? c.success(String(stats.commits)) + c.dim(' commit' + (stats.commits !== 1 ? 's' : '')) : '',
  ].filter(Boolean).join(c.dim('  ·  '));

  lines.push(center(stats_row, w));
  if (stats.model) lines.push(center(c.dim('model: ' + stats.model), w));
  lines.push('');
  lines.push(center(c.muted('Goodbye 👋'), w));
  lines.push('');
  lines.push(hr);
  lines.push('');
  return lines.join('\n');
}

// ── Help panel ────────────────────────────────────────────────────────────────
export function helpPanel(): string {
  const w     = W();
  const lines: string[] = [];
  const hr    = () => lines.push('  ' + c.dim('─'.repeat(Math.min(66, w - 4))));
  const sec   = (t: string) => { lines.push(''); lines.push(`  ${c.accent.bold(t)}`); lines.push(''); };
  const row   = (k: string, v: string) => lines.push(`  ${c.primary(k.padEnd(34))} ${c.muted(v)}`);
  const div   = (label: string) => {
    const prefix = `── ${label} `;
    const fill   = Math.max(0, Math.min(66, w - 4) - prefix.length);
    lines.push('  ' + c.dim(prefix + '─'.repeat(fill)));
  };

  lines.push('');
  hr();
  lines.push(`  ${c.primary.bold('◆ SOPHOS')}  ${c.dim('v3.0  ·  Multi-Agent Orchestrator')}`);
  hr();

  sec('JUST DESCRIBE WHAT YOU WANT');
  row('"add JWT auth with refresh tokens"',  'full 9-phase pipeline');
  row('"fix the login race condition"',      'analyse + patch + validate');
  row('"why is checkout slow?"',             'plan mode — analysis only');
  row('"show me src/auth/jwt.ts"',           'view file');
  row('"revert last change"',                'git stash');

  div('or use explicit commands');

  sec('MODEL COMMANDS');
  row('/models',                   'role assignment table');
  row('/models assign',            'interactive arrow-key picker');
  row('/models suggest',           'smart upgrade suggestions');
  row('/models coder <name>',      'set coder model');
  row('/models planner <name>',    'set planner model');
  row('/models executor <name>',   'set executor model');
  row('/models chat <name>',       'set chat model');
  row('/models scanner <name>',    'set scanner (analysis) model');
  row('/models architect <name>',  'set architect (planning) model');
  row('/models save local',        'save to .sophos.json');
  row('/models save global',       'save to ~/.config/sophos/config.json');

  div('git');

  sec('GIT COMMANDS');
  row('/diff',                 'current changes (colored)');
  row('/git status',           'working tree status');
  row('/git log [n]',          'recent commits');
  row('/git commit <msg>',     'commit staged changes');
  row('/git branch <name>',    'create branch');
  row('/rollback',             'stash + revert');

  div('other');

  sec('OTHER');
  row('/plan on|off',          'toggle plan-only mode');
  row('/security',             'last scan results');
  row('/cost',                 'token usage');
  row('/config',               'show project config');
  row('/config init',          'initialize .sophos/');
  row('/status',               'project status + models');
  row('/compact',              'compress conversation context');
  row('/clear',                'clear screen + history');
  row('/exit',                 'quit');

  div('webui & mcp');

  sec('WEBUI & MCP');
  row('/webui [port]',         'start browser interface (default: 3777)');
  row('/mcp',                  'start MCP server (stdio transport)');
  row('/tunnel [port] [prov]', 'expose port via tunnel');

  div('keyboard shortcuts');

  sec('SHORTCUTS');
  row('/',          'open command menu (↑↓ select · ↵ run · tab complete)');
  row('@',          'mention a file — fuzzy path completion');
  row('Esc',        'interrupt pipeline · dismiss menu · clear input');
  row('Ctrl+C',     'clear input — press twice to quit');
  row('Ctrl+T',     'new session tab');
  row('Ctrl+W',     'close session tab (when input is empty)');
  row('Tab',        'switch session (when input is empty)');
  row('Ctrl+D',     'diff of last pipeline');
  row('Ctrl+N',     'notification tray');
  row('Ctrl+L',     'clear screen');
  row('PgUp/PgDn',  'scroll transcript (shift+↑/↓ by line)');
  row('↑ / ↓',      'history — persists across restarts');
  row('ship it',    'after pipeline — commit + push');
  row('diff',       'after pipeline — review changes');
  row('abort',      'after pipeline — discard');

  lines.push('');
  hr();
  lines.push('');
  return lines.join('\n');
}

// ── Notification tray ─────────────────────────────────────────────────────────
export interface Notification {
  type:    'info' | 'success' | 'warning' | 'error';
  message: string;
}

export function notificationTray(notifications: Notification[]): string {
  if (!notifications.length) return '';
  const icon = (t: Notification['type']) =>
    t === 'success' ? c.success('✓') :
    t === 'warning' ? c.warning('⚠') :
    t === 'error'   ? c.error('✗')   : c.info('i');
  const lines = notifications.slice(0, 5).map(n =>
    `  ${icon(n.type)}  ${c.muted(n.message.slice(0, 72))}`
  );
  return [`  ${c.dim('─── notifications ───')}`, ...lines, ''].join('\n');
}

// ── Cancellation summary card ────────────────────────────────────────────────
// Shown when user presses Ctrl+C during a pipeline. Displays what was
// completed, what was interrupted, and how to resume.
export function cancelCard(opts: {
  request:      string;
  phasesDone:   number;
  phasesTotal:  number;
  activePhase?: string;
  elapsed:      string;
  filesChanged?: number;
}): string {
  const w  = W();
  const lines: string[] = [''];
  const hr = '  ' + c.dim('─'.repeat(w - 4));

  lines.push(hr);
  lines.push('');

  // Header
  lines.push(`  ${c.warning('⚡')}  ${c.warning.bold('Pipeline cancelled')}`);
  lines.push('');

  // What was running
  const pct = opts.phasesTotal > 0 ? Math.floor((opts.phasesDone / opts.phasesTotal) * 100) : 0;
  const bar = progressBar(opts.phasesDone, opts.phasesTotal, '', 20);
  lines.push(`  ${c.dim('progress:')}  ${bar}  ${c.dim(pct + '%')}`);
  lines.push('');

  // Phase breakdown
  if (opts.activePhase) {
    lines.push(`  ${c.dim('interrupted:')}  ${c.warning(opts.activePhase)}`);
  }
  if (opts.phasesDone > 0) {
    lines.push(`  ${c.dim('completed:')}    ${c.success(String(opts.phasesDone))} ${c.dim('phases saved')}`);
  }
  lines.push(`  ${c.dim('elapsed:')}      ${c.dim(opts.elapsed)}`);
  if (opts.filesChanged) {
    lines.push(`  ${c.dim('files:')}        ${c.info(String(opts.filesChanged))} ${c.dim('written to disk')}`);
  }

  lines.push('');
  lines.push(hr);
  lines.push('');

  // Action hints
  const hints: string[] = [];
  if (opts.phasesDone > 0) {
    hints.push(`${c.primary.bold('resume')}  continue where you left off`);
  }
  hints.push(`${c.muted('diff')}      review what was written so far`);
  hints.push(`${c.muted('exit')}      discard and quit`);
  for (const h of hints) {
    lines.push(`  ${c.dim('›')} ${h}`);
  }

  lines.push('');
  return lines.join('\n');
}

// ── Post-pipeline quick actions bar ───────────────────────────────────────────
// Compact action chips shown after pipeline completes. Single-key shortcuts.
export function actionsBar(opts: {
  canShip?:  boolean;
  canDiff?:   boolean;
  hasFiles?:  boolean;
}): string {
  const actions: string[] = [];

  if (opts.canShip) {
    actions.push(c.success.bold('s') + c.success(' ship'));
  }
  if (opts.canDiff) {
    actions.push(c.primary.bold('d') + c.primary(' diff'));
  }
  if (opts.hasFiles) {
    actions.push(c.accent.bold('r') + c.accent(' review'));
  }
  actions.push(c.warning.bold('a') + c.warning(' abort'));

  if (!actions.length) return '';
  return `  ${c.dim('─── quick actions ───')}  ${actions.join(c.dim('  ·  '))}`;
}

// ── Interactive help hint (rendered inside the live pipeline region) ──────────
export function pipelineHint(): string {
  return `  ${c.dim('↑↓ phases · ↵ expand · a all · c collapse · esc to interrupt')}`;
}

// ── Confirmation prompt ───────────────────────────────────────────────────────
export function confirmPrompt(message: string): string {
  return `  ${c.warning('⚠')}  ${c.text(message)}  ${c.dim('(y/N)')} `;
}

// ── lineColor helper (used by phaseCard) ─────────────────────────────────────
function lineColor(line: string): string {
  if (/✅|✓|passed|complete|approved/.test(line)) return c.success(line);
  if (/❌|✗|failed|error/i.test(line))            return c.error(line);
  if (/⚠|warning|warn/i.test(line))              return c.warning(line);
  if (/^\s*\$\s/.test(line))                      return c.dim(line);
  return c.muted(line);
}

// ── Legacy ui compat ──────────────────────────────────────────────────────────
export const ui = {
  colors: {
    primary:   chalk.hex(TOKENS.colors.accent),
    secondary: chalk.hex(TOKENS.colors.info),
    accent:    chalk.hex(TOKENS.colors.orange),
    success:   chalk.hex(TOKENS.colors.success),
    warning:   chalk.hex(TOKENS.colors.warning),
    error:     chalk.hex(TOKENS.colors.error),
    info:      chalk.hex(TOKENS.colors.info),
    muted:     chalk.hex(TOKENS.colors.textSecondary),
    dim:       chalk.hex(TOKENS.colors.muted),
    bold:      chalk.bold,
    reset:     chalk.reset,
  },
  line(text: string, width = W()): string {
    const visible = text.replace(/\x1B\[[0-9;]*[mK]/g, '');
    return '─'.repeat(Math.max(0, width - visible.length - 2));
  },
  center,
  banner,
  sectionHeader(title: string): string {
    const w = W();
    return `\n${this.colors.primary('╭')} ${this.colors.primary.bold(title)} ${this.colors.dim('─'.repeat(Math.max(0, w - title.length - 6)))}${this.colors.primary('╮')}`;
  },
  sectionFooter(): string {
    return `${this.colors.primary('╰')}${'─'.repeat(W() - 4)}${this.colors.primary('╯')}`;
  },
  progress: progressBar,
  diffLine(line: string): string {
    if (line.startsWith('+') && !line.startsWith('+++')) return chalk.hex(TOKENS.colors.success)(line);
    if (line.startsWith('-') && !line.startsWith('---')) return chalk.hex(TOKENS.colors.error)(line);
    if (line.startsWith('@@'))                           return chalk.hex(TOKENS.colors.info)(line);
    if (line.startsWith('---') || line.startsWith('+++')) return chalk.hex(TOKENS.colors.textSecondary)(line);
    return line;
  },
  formatDuration,
  formatNumber,
  clear(): void { process.stdout.write(ANSI.clearScreen); },
};
