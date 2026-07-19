// ── Sophos Design System v2.0 ─────────────────────────────────────────────────
// Modern design system inspired by Claude Code and Grok Code patterns
// Provides consistent spacing, typography, and component styling

import chalk from 'chalk';

// ── Enhanced Color Palette ───────────────────────────────────────────────────
export const COLORS = {
  // Base colors (Catppuccin Mocha)
  base: {
    bg: '#1e1e2e',
    surface: '#313244',
    surface2: '#292940',
    border: '#45475a',
    textPrimary: '#cdd6f4',
    textSecondary: '#a6adc8',
    muted: '#585b70',
    dim: '#6c7086',
  },
  
  // Accent colors
  accent: {
    primary: '#89b4fa',
    secondary: '#74c7ec',
    tertiary: '#94e2d5',
  },
  
  // Semantic colors
  semantic: {
    success: '#a6e3a1',
    warning: '#f9e2af',
    error: '#f38ba8',
    info: '#89dceb',
  },
  
  // Extended palette
  extended: {
    orange: '#fab387',
    purple: '#cba6f7',
    pink: '#f5c2e7',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    red: '#f38ba8',
    cyan: '#89dceb',
  },
} as const;

// ── Chalk Instances ──────────────────────────────────────────────────────────
export const c = {
  // Text
  text: chalk.hex(COLORS.base.textPrimary),
  secondary: chalk.hex(COLORS.base.textSecondary),
  muted: chalk.hex(COLORS.base.muted),
  dim: chalk.hex(COLORS.base.dim),
  
  // Accents
  primary: chalk.hex(COLORS.accent.primary),
  accent: chalk.hex(COLORS.accent.primary),
  highlight: chalk.hex(COLORS.accent.secondary),
  
  // Semantic
  success: chalk.hex(COLORS.semantic.success),
  warning: chalk.hex(COLORS.semantic.warning),
  error: chalk.hex(COLORS.semantic.error),
  info: chalk.hex(COLORS.semantic.info),
  
  // Extended
  orange: chalk.hex(COLORS.extended.orange),
  purple: chalk.hex(COLORS.extended.purple),
  pink: chalk.hex(COLORS.extended.pink),
  green: chalk.hex(COLORS.extended.green),
  yellow: chalk.hex(COLORS.extended.yellow),
  red: chalk.hex(COLORS.extended.red),
  cyan: chalk.hex(COLORS.extended.cyan),
  
  // Modifiers
  bold: chalk.bold,
  italic: chalk.italic,
  underline: chalk.underline,
  
  // Backgrounds
  bg: {
    surface: chalk.bgHex(COLORS.base.surface),
    surface2: chalk.bgHex(COLORS.base.surface2),
    accent: chalk.bgHex(COLORS.accent.primary),
  },
};

// ── Spacing System ───────────────────────────────────────────────────────────
export const SPACING = {
  xs: 1,
  sm: 2,
  md: 4,
  lg: 8,
  xl: 12,
  xxl: 16,
} as const;

// ── Typography ───────────────────────────────────────────────────────────────
export const TYPOGRAPHY = {
  fontFamily: 'monospace',
  lineHeight: 1.5,
  
  sizes: {
    xs: 10,  // small labels, metadata
    sm: 11,  // body text, descriptions
    md: 12,  // main content
    lg: 13,  // headers, titles
    xl: 14,  // large headers
    xxl: 16, // hero text
  },
  
  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

// ── Borders & Corners ────────────────────────────────────────────────────────
export const BORDERS = {
  radius: {
    sm: 2,
    md: 4,
    lg: 6,
    xl: 8,
    round: 999,
  },
  
  width: {
    thin: 1,
    normal: 1,
    thick: 2,
  },
} as const;

// ── Icons & Symbols ──────────────────────────────────────────────────────────
export const ICONS = {
  status: {
    pending: c.dim('○'),
    running: c.warning('◐'),
    passed: c.success('✓'),
    failed: c.error('✗'),
    skipped: c.muted('─'),
  },
  
  tasks: {
    queue: c.dim('○'),
    active: c.warning('◐'),
    done: c.success('●'),
    failed: c.error('●'),
    repair: c.orange('◑'),
  },
  
  navigation: {
    chevron: {
      right: '›',
      down: '▼',
      up: '▲',
      left: '‹',
    },
    arrow: {
      right: '→',
      left: '←',
      up: '↑',
      down: '↓',
    },
  },
  
  misc: {
    dot: '•',
    pipe: '│',
    branch: '├',
    end: '└',
  },
} as const;

// ── Layout Utilities ─────────────────────────────────────────────────────────
export function getTerminalWidth(): number {
  return Math.min(process.stdout.columns || 80, 120);
}

export function getTerminalHeight(): number {
  return process.stdout.rows || 24;
}

export function centerText(text: string, width?: number): string {
  const w = width || getTerminalWidth();
  const textWidth = stripAnsi(text).length;
  const padding = Math.max(0, Math.floor((w - textWidth) / 2));
  return ' '.repeat(padding) + text;
}

export function rightAlign(text: string, width?: number): string {
  const w = width || getTerminalWidth();
  const textWidth = stripAnsi(text).length;
  const padding = Math.max(0, w - textWidth);
  return ' '.repeat(padding) + text;
}

export function createDivider(char: string = '─', width?: number): string {
  const w = width || getTerminalWidth();
  return c.dim(char.repeat(w));
}

export function createSection(title: string, width?: number): string {
  const w = width || getTerminalWidth();
  const titleText = ` ${title} `;
  const dashLength = Math.max(0, w - stripAnsi(titleText).length);
  return c.dim('─'.repeat(Math.floor(dashLength / 2))) + 
         c.bold(titleText) + 
         c.dim('─'.repeat(Math.ceil(dashLength / 2)));
}

// ── Text Utilities ───────────────────────────────────────────────────────────
export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[mK]/g, '');
}

export function truncate(text: string, maxLength: number, ellipsis: string = '…'): string {
  const clean = stripAnsi(text);
  if (clean.length <= maxLength) return text;
  
  const truncated = clean.slice(0, maxLength - ellipsis.length);
  return text.slice(0, truncated.length) + c.dim(ellipsis);
}

export function wordWrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const result: string[] = [];
  let line = '';
  
  for (const word of words) {
    const testLine = line + (line ? ' ' : '') + word;
    if (stripAnsi(testLine).length > width && line) {
      result.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  
  if (line) result.push(line);
  return result;
}

// ── Component Styles ─────────────────────────────────────────────────────────
export const COMPONENT_STYLES = {
  card: {
    padding: SPACING.md,
    borderColor: COLORS.base.border,
    backgroundColor: COLORS.base.surface,
  },
  
  button: {
    padding: `${SPACING.xs}px ${SPACING.md}px`,
    borderRadius: BORDERS.radius.md,
    borderColor: COLORS.base.border,
    hover: {
      backgroundColor: COLORS.base.surface2,
    },
  },
  
  input: {
    padding: `${SPACING.sm}px ${SPACING.md}px`,
    borderColor: COLORS.base.border,
    focus: {
      borderColor: COLORS.accent.primary,
    },
  },
  
  badge: {
    padding: `${SPACING.xs}px ${SPACING.sm}px`,
    borderRadius: BORDERS.radius.round,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
};

// ── Animation ────────────────────────────────────────────────────────────────
export const ANIMATION = {
  frames: {
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    dots: ['   ', '.  ', '.. ', '...'],
    progress: ['▰▱▱▱▱', '▰▰▱▱▱', '▰▰▰▱▱', '▰▰▰▰▱', '▰▰▰▰▰'],
  },
  
  timing: {
    fast: 80,
    normal: 120,
    slow: 200,
  },
};

// ── Export Types ─────────────────────────────────────────────────────────────
export type ColorName = keyof typeof COLORS.extended;
export type IconName = keyof typeof ICONS.status | keyof typeof ICONS.tasks;
export type SpacingSize = keyof typeof SPACING;