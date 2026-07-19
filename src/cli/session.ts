// ── Session Manager ───────────────────────────────────────────────────────────
// Manages conversation history. Saves per-project in .sophos/sessions/ with
// fallback to global ~/.config/sophos/sessions/.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  tool?: string;
}

export class SessionManager {
  private messages: ConversationMessage[] = [];
  private tokenEstimate: number = 0;
  private maxTokens: number = 128000;
  private projectDir: string;

  constructor(private model: string, projectDir: string) {
    this.projectDir = projectDir;
  }

  addMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string, tool?: string): ConversationMessage {
    const msg: ConversationMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: Date.now(),
      tool,
    };
    this.messages.push(msg);
    this.tokenEstimate += Math.ceil(content.length / 3.5);
    return msg;
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  getTokenEstimate(): number {
    return this.tokenEstimate;
  }

  /** Percentage of the context window consumed (0–100). */
  getContextPct(): number {
    return Math.min(100, Math.round((this.tokenEstimate / this.maxTokens) * 100));
  }

  isNearLimit(): boolean {
    return this.tokenEstimate > this.maxTokens * 0.8;
  }

  async compact(): Promise<{ summary: string; messagesRemoved: number; tokensSaved: number }> {
    const keepLast = 20;
    const toCompact = this.messages.slice(0, -keepLast);
    const kept = this.messages.slice(-keepLast);
    const tokensBefore = this.tokenEstimate;

    const summaryLines: string[] = [];
    summaryLines.push(`[Context Compaction: ${toCompact.length} messages summarized]`);

    const userMessages = toCompact.filter(m => m.role === 'user');
    if (userMessages.length > 0) {
      summaryLines.push(`User requests: ${userMessages.map(m => m.content.slice(0, 80)).join('; ')}`);
    }

    const compactMsg: ConversationMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      content: summaryLines.join('\n'),
      timestamp: Date.now(),
    };

    this.messages = [compactMsg, ...kept];
    this.tokenEstimate = this.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 3.5), 0);
    const tokensSaved = tokensBefore - this.tokenEstimate;

    return { summary: summaryLines.join('\n'), messagesRemoved: toCompact.length, tokensSaved };
  }

  exportSession(): string {
    return JSON.stringify({
      model: this.model,
      project: this.projectDir,
      messageCount: this.messages.length,
      tokenEstimate: this.tokenEstimate,
      messages: this.messages,
    }, null, 2);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  // Prefer .sophos/sessions/ (project), fall back to ~/.config/sophos/sessions/ (global)
  private getProjectSessionsDir(): string {
    return path.join(this.projectDir, '.sophos', 'sessions');
  }

  private getGlobalSessionsDir(): string {
    return path.join(os.homedir(), '.config', 'sophos', 'sessions');
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  saveSession(filename?: string): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = filename || `session-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;

    // Prefer project store
    const projectDir = this.getProjectSessionsDir();
    if (fs.existsSync(path.join(this.projectDir, '.sophos'))) {
      this.ensureDir(projectDir);
      const fp = path.join(projectDir, name);
      fs.writeFileSync(fp, this.exportSession(), 'utf-8');
      return fp;
    }

    // Fallback to global
    const globalDir = this.getGlobalSessionsDir();
    this.ensureDir(globalDir);
    const fp = path.join(globalDir, name);
    fs.writeFileSync(fp, this.exportSession(), 'utf-8');
    return fp;
  }

  listSessions(): string[] {
    const results: string[] = [];

    // Project sessions
    const projectDir = this.getProjectSessionsDir();
    if (fs.existsSync(projectDir)) {
      try {
        results.push(...fs.readdirSync(projectDir)
          .filter(f => f.endsWith('.json'))
          .map(f => `[project] ${f}`));
      } catch { /* */ }
    }

    // Global sessions
    const globalDir = this.getGlobalSessionsDir();
    if (fs.existsSync(globalDir)) {
      try {
        results.push(...fs.readdirSync(globalDir)
          .filter(f => f.endsWith('.json'))
          .sort()
          .reverse()
          .slice(0, 20)
          .map(f => f));
      } catch { /* */ }
    }

    return results;
  }

  clear(): void {
    this.messages = [];
    this.tokenEstimate = 0;
  }
}
