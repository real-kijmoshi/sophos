export interface PermissionRule {
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
}

export type ToolName =
  | 'read' | 'write' | 'edit' | 'bash' | 'glob' | 'grep'
  | 'webfetch' | 'websearch' | 'git' | 'delete' | 'rename';

export class PermissionSystem {
  private rules: Record<ToolName, PermissionRule[]>;
  private defaults: Record<ToolName, 'allow' | 'deny' | 'ask'>;
  private sessionOverrides: Map<string, 'allow' | 'deny'> = new Map();
  private ephemeralAllow: Set<string> = new Set();

  constructor() {
    this.rules = {
      read:     [{ pattern: '*', action: 'allow' }],
      write:    [{ pattern: '*', action: 'ask' }],
      edit:     [{ pattern: '*', action: 'ask' }],
      bash:     [{ pattern: 'git status', action: 'allow' }, { pattern: 'git diff', action: 'allow' }, { pattern: 'git log*', action: 'allow' }, { pattern: 'ls*', action: 'allow' }, { pattern: 'cat*', action: 'allow' }, { pattern: 'find*', action: 'allow' }, { pattern: 'grep*', action: 'allow' }, { pattern: 'node*', action: 'ask' }, { pattern: 'npm*', action: 'ask' }, { pattern: 'npx*', action: 'ask' }, { pattern: 'rm*', action: 'deny' }, { pattern: 'sudo*', action: 'deny' }, { pattern: '*', action: 'ask' }],
      glob:     [{ pattern: '*', action: 'allow' }],
      grep:     [{ pattern: '*', action: 'allow' }],
      webfetch: [{ pattern: '*', action: 'allow' }],
      websearch:[{ pattern: '*', action: 'allow' }],
      git:      [{ pattern: 'status', action: 'allow' }, { pattern: 'diff*', action: 'allow' }, { pattern: 'log*', action: 'allow' }, { pattern: 'add*', action: 'ask' }, { pattern: 'commit*', action: 'ask' }, { pattern: 'push*', action: 'ask' }, { pattern: 'checkout*', action: 'deny' }, { pattern: '*', action: 'ask' }],
      delete:   [{ pattern: '*', action: 'deny' }],
      rename:   [{ pattern: '*', action: 'ask' }],
    };
    this.defaults = {
      read: 'allow', write: 'ask', edit: 'ask', bash: 'ask',
      glob: 'allow', grep: 'allow', webfetch: 'allow', websearch: 'allow',
      git: 'ask', delete: 'deny', rename: 'ask',
    };
  }

  async check(tool: ToolName, target: string, promptFn?: (msg: string) => Promise<boolean>): Promise<'allow' | 'deny'> {
    const ephemeralKey = `${tool}:${target}`;
    if (this.ephemeralAllow.has(ephemeralKey)) return 'allow';

    const sessionKey = `${tool}:${target}`;
    if (this.sessionOverrides.has(sessionKey)) {
      return this.sessionOverrides.get(sessionKey)!;
    }

    const toolRules = this.rules[tool] || [];
    for (const rule of toolRules) {
      if (this.matches(rule.pattern, target)) {
        if (rule.action === 'ask') {
          if (!promptFn) return 'deny';
          const allowed = await promptFn(`Allow ${tool} on "${this.truncateTarget(target)}"?`);
          if (allowed) this.ephemeralAllow.add(ephemeralKey);
          return allowed ? 'allow' : 'deny';
        }
        return rule.action;
      }
    }

    const defaultAction = this.defaults[tool] || 'ask';
    if (defaultAction === 'ask') {
      if (!promptFn) return 'deny';
      const allowed = await promptFn(`Allow ${tool} on "${this.truncateTarget(target)}"?`);
      if (allowed) this.ephemeralAllow.add(ephemeralKey);
      return allowed ? 'allow' : 'deny';
    }
    return defaultAction;
  }

  allowForSession(tool: ToolName, target: string): void {
    this.sessionOverrides.set(`${tool}:${target}`, 'allow');
  }

  denyForSession(tool: ToolName, target: string): void {
    this.sessionOverrides.set(`${tool}:${target}`, 'deny');
  }

  allowAllForSession(tool: ToolName): void {
    this.sessionOverrides.set(`${tool}:*`, 'allow');
  }

  private matches(pattern: string, target: string): boolean {
    if (pattern === '*') return true;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return regex.test(target);
  }

  private truncateTarget(target: string): string {
    return target.length > 50 ? target.slice(0, 47) + '...' : target;
  }

  getSummary(): string[] {
    const lines: string[] = [];
    for (const [tool, toolRules] of Object.entries(this.rules)) {
      const allowCount = toolRules.filter(r => r.action === 'allow').length;
      const denyCount = toolRules.filter(r => r.action === 'deny').length;
      const askCount = toolRules.filter(r => r.action === 'ask').length;
      lines.push(`${tool}: ${allowCount} allow, ${askCount} ask, ${denyCount} deny`);
    }
    return lines;
  }
}
