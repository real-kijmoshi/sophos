// ── Sophos Modern UI Components ───────────────────────────────────────────────
// Enhanced UI components with better spacing, typography, and interactivity
// Inspired by Claude Code and Grok Code patterns

import { 
  c, COLORS, SPACING, TYPOGRAPHY, BORDERS, ICONS, 
  getTerminalWidth, stripAnsi, truncate, wordWrap, 
  centerText, createDivider, createSection 
} from './design-system.js';

// ── Component: Modern Card ───────────────────────────────────────────────────
export interface CardOptions {
  title?: string;
  padding?: number;
  border?: boolean;
  backgroundColor?: string;
  width?: number;
  collapsible?: boolean;
  collapsed?: boolean;
}

export function createCard(
  content: string | string[],
  options: CardOptions = {}
): string {
  const width = options.width || getTerminalWidth() - 4;
  const padding = options.padding ?? SPACING.md;
  const hasBorder = options.border ?? true;
  const bgColor = options.backgroundColor || COLORS.base.surface;
  
  const lines = Array.isArray(content) ? content : [content];
  const paddedLines = lines.flatMap(line => 
    wordWrap(line, width - padding * 2)
  );
  
  let result = '';
  
  // Title
  if (options.title) {
    const title = ` ${options.title} `;
    const titleWidth = stripAnsi(title).length;
    const availableWidth = width - 2;
    const dashCount = Math.max(0, availableWidth - titleWidth);
    const leftDash = Math.floor(dashCount / 2);
    const rightDash = Math.ceil(dashCount / 2);
    
    if (hasBorder) {
      result += c.dim('┌') + c.dim('─'.repeat(leftDash)) + 
                c.bold(title) + c.dim('─'.repeat(rightDash)) + c.dim('┐') + '\n';
    } else {
      result += c.dim('─'.repeat(leftDash)) + c.bold(title) + 
                c.dim('─'.repeat(rightDash)) + '\n';
    }
  } else if (hasBorder) {
    result += c.dim('┌' + '─'.repeat(width - 2) + '┐') + '\n';
  }
  
  // Content
  for (const line of paddedLines) {
    const lineText = ' '.repeat(padding) + line + 
                     ' '.repeat(width - stripAnsi(line).length - padding - 2);
    
    if (hasBorder) {
      result += c.dim('│') + lineText + c.dim('│') + '\n';
    } else {
      result += lineText + '\n';
    }
  }
  
  // Footer
  if (hasBorder) {
    result += c.dim('└' + '─'.repeat(width - 2) + '┘');
  }
  
  return result;
}

// ── Component: Status Badge ──────────────────────────────────────────────────
export interface BadgeOptions {
  color?: keyof typeof COLORS.extended;
  variant?: 'solid' | 'outline' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
}

export function createBadge(
  text: string,
  options: BadgeOptions = {}
): string {
  const colorName = options.color || 'cyan';
  const variant = options.variant || 'subtle';
  const size = options.size || 'md';
  
  const color = COLORS.extended[colorName];
  const baseColor = chalk.hex(color);
  
  const sizeMap = {
    sm: { padding: SPACING.xs, fontSize: TYPOGRAPHY.sizes.xs },
    md: { padding: SPACING.sm, fontSize: TYPOGRAPHY.sizes.sm },
    lg: { padding: SPACING.md, fontSize: TYPOGRAPHY.sizes.md },
  };
  
  const { padding, fontSize } = sizeMap[size];
  const badgeText = ` ${text} `;
  
  switch (variant) {
    case 'solid':
      return baseColor.bgHex(COLORS.base.surface)(badgeText);
    case 'outline':
      return baseColor(`[${badgeText}]`);
    case 'subtle':
    default:
      return c.dim('[') + baseColor(badgeText) + c.dim(']');
  }
}

// ── Component: Progress Bar ──────────────────────────────────────────────────
export interface ProgressBarOptions {
  width?: number;
  showPercentage?: boolean;
  showLabel?: boolean;
  color?: keyof typeof COLORS.extended;
}

export function createProgressBar(
  value: number, // 0-100
  label?: string,
  options: ProgressBarOptions = {}
): string {
  const width = options.width || 40;
  const showPercentage = options.showPercentage ?? true;
  const showLabel = options.showLabel ?? true;
  const colorName = options.color || 'accent';
  const color = COLORS.extended[colorName] || COLORS.accent.primary;
  
  const clampedValue = Math.max(0, Math.min(100, value));
  const fillWidth = Math.floor((clampedValue / 100) * width);
  const emptyWidth = width - fillWidth;
  
  const fillChar = '█';
  const emptyChar = '░';
  
  const bar = chalk.hex(color)(fillChar.repeat(fillWidth)) + 
              c.dim(emptyChar.repeat(emptyWidth));
  
  let result = '';
  
  if (showLabel && label) {
    result += c.text(label) + ' ';
  }
  
  result += bar;
  
  if (showPercentage) {
    result += ' ' + c.bold(`${clampedValue.toFixed(0)}%`);
  }
  
  return result;
}

// ── Component: Phase Display (Modern) ────────────────────────────────────────
export interface PhaseDisplayOptions {
  number: number;
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  progress?: number; // 0-100 for running phases
  details?: string[];
  collapsed?: boolean;
  width?: number;
}

export function createPhaseDisplay(options: PhaseDisplayOptions): string {
  const width = options.width || getTerminalWidth() - 4;
  const icon = ICONS.status[options.status];
  const duration = options.durationMs ? 
    c.dim(` ${formatDuration(options.durationMs)}`) : '';
  
  // Status color mapping
  const nameColor = 
    options.status === 'passed' ? c.success :
    options.status === 'failed' ? c.error :
    options.status === 'running' ? c.warning :
    options.status === 'skipped' ? c.muted : c.dim;
  
  const numberText = c.dim(options.number.toString().padStart(2));
  const nameText = nameColor(options.name);
  
  // Header line
  let header = `  ${icon} ${numberText}  ${nameText}${duration}`;
  
  // Add progress if running
  if (options.status === 'running' && options.progress !== undefined) {
    const progressBar = createProgressBar(options.progress, '', {
      width: 20,
      showPercentage: false,
      color: 'warning',
    });
    header += ' ' + progressBar;
  }
  
  // Add chevron if collapsible
  if (options.details && options.details.length > 0) {
    const chevron = options.collapsed ? ICONS.navigation.chevron.right : ICONS.navigation.chevron.down;
    header += ' ' + c.dim(chevron);
  }
  
  // If collapsed or no details, just return header
  if (options.collapsed || !options.details || options.details.length === 0) {
    return header;
  }
  
  // Build details section
  const details = options.details.slice(-4); // Show last 4 lines
  const detailLines = details.map(detail => {
    const wrapped = wordWrap(detail, width - 8);
    return wrapped.map(line => `      ${c.text(line)}`).join('\n');
  }).join('\n');
  
  return `${header}\n${detailLines}`;
}

// ── Component: Task Grid (Modern) ────────────────────────────────────────────
export interface TaskItem {
  id: string;
  description: string;
  status: 'queue' | 'active' | 'done' | 'failed' | 'repair';
  reviewers?: string;
  effort?: number; // 1-5
}

export function createTaskGrid(
  tasks: TaskItem[],
  width?: number
): string {
  const w = width || getTerminalWidth() - 4;
  
  if (tasks.length === 0) {
    return createCard(['No tasks yet'], { border: true, width: w });
  }
  
  const idWidth = 10;
  const descWidth = Math.max(20, Math.floor(w * 0.5));
  const statusWidth = 12;
  const reviewWidth = Math.max(10, w - idWidth - descWidth - statusWidth - 12);
  
  // Header
  const header = [
    c.dim('ID'.padEnd(idWidth)),
    c.dim('Description'.padEnd(descWidth)),
    c.dim('Status'.padEnd(statusWidth)),
    c.dim('Review'.padEnd(reviewWidth)),
  ].join('  ');
  
  const separator = c.dim('─'.repeat(w));
  
  // Rows
  const rows = tasks.map(task => {
    const statusIcon = ICONS.tasks[task.status];
    const statusColor = 
      task.status === 'done' ? c.success :
      task.status === 'failed' ? c.error :
      task.status === 'active' ? c.warning :
      task.status === 'repair' ? c.orange : c.dim;
    
    const statusText = statusColor(`${statusIcon} ${task.status}`);
    
    const effortBadge = task.effort ? 
      c.dim(`[${'◆'.repeat(task.effort)}${'◇'.repeat(5 - task.effort)}]`) : '';
    
    return [
      c.accent(truncate(task.id, idWidth)),
      c.text(truncate(task.description, descWidth)),
      statusText.padEnd(statusWidth + 2),
      c.dim(truncate(task.reviewers || '—', reviewWidth - (effortBadge ? 8 : 0))) + effortBadge,
    ].join('  ');
  });
  
  return [header, separator, ...rows].join('\n');
}

// ── Component: Streaming Output (Modern) ─────────────────────────────────────
export interface StreamingOutputOptions {
  text: string;
  agent?: string;
  tokenCount?: number;
  elapsedMs?: number;
  showCursor?: boolean;
  width?: number;
}

export function createStreamingOutput(options: StreamingOutputOptions): string {
  const width = options.width || getTerminalWidth() - 8;
  const lines: string[] = [];
  
  // Agent header
  if (options.agent) {
    lines.push(`${c.dim('├─')} ${c.accent(options.agent)}`);
  }
  
  // Stream content (last 3 lines)
  const streamLines = options.text.split('\n').slice(-3);
  for (const line of streamLines) {
    if (line.trim()) {
      const truncated = truncate(line, width);
      lines.push(`${c.dim('│')} ${c.text(truncated)}`);
      
      // Add blinking cursor to last line if streaming
      if (options.showCursor && line === streamLines[streamLines.length - 1]) {
        lines[lines.length - 1] += c.accent('▌');
      }
    }
  }
  
  // Status footer
  const footerParts: string[] = [];
  if (options.tokenCount && options.tokenCount > 0) {
    footerParts.push(c.dim(`${formatNumber(options.tokenCount)} tokens`));
  }
  if (options.elapsedMs) {
    footerParts.push(c.dim(formatDuration(options.elapsedMs)));
  }
  
  if (footerParts.length > 0) {
    lines.push(`${c.dim('└─')} ${footerParts.join(c.dim('  '))}`);
  }
  
  return lines.join('\n');
}

// ── Utility Functions ────────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

// Re-export chalk for compatibility
import chalk from 'chalk';
export { chalk };