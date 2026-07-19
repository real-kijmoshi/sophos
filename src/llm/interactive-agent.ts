// ── InteractiveAgent — fast agentic loop for chat, questions, small edits ─────
// The counterpart to the 9-phase pipeline: one model, a small tool belt, and a
// read→act→verify loop. Works with any Ollama model (no native function-calling
// required) — each turn the model returns ONE JSON action, we execute it and
// feed the result back. Command execution is gated by the PermissionSystem via
// an async approve callback; file edits stay inside the project directory.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { LLMAgent } from './agent.js';
import type { LLMMessage } from './client.js';

const MAX_STEPS        = 15;
const MAX_READ_LINES   = 400;
const MAX_DIR_ENTRIES  = 100;
const MAX_SEARCH_HITS  = 40;
const MAX_CMD_OUTPUT   = 8_000;    // chars, tail-truncated
const CMD_TIMEOUT_MS   = 60_000;
const MAX_FILE_BYTES   = 262_144;  // per file considered by search

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'target',
  '.sophos', '.claude', '__pycache__', '.next', '.nuxt', '.venv', 'venv',
]);

export interface AgentEvents {
  /** A tool is about to run — short human-readable description. */
  onAction?: (line: string) => void;
  /** The tool finished — short result summary. */
  onResult?: (line: string) => void;
  /** Ask the user to approve a shell command. Resolve false to deny. */
  approveCommand?: (command: string) => Promise<boolean>;
}

export interface AgentRunResult {
  answer:       string;
  steps:        number;
  filesChanged: string[];
  totalTokens:  number;
}

interface ToolAction { tool: string; args: Record<string, any>; }

const SYSTEM_PROMPT = (projectDir: string) => `You are Sophos, a coding agent working directly inside the user's repository.
Project directory: ${projectDir}

Respond with EXACTLY ONE JSON object per turn and nothing else. Available tools:

{"tool":"read_file","args":{"path":"src/x.ts","start_line":1,"end_line":200}}   read a file (line range optional)
{"tool":"list_dir","args":{"path":"src"}}                                        list a directory
{"tool":"search","args":{"pattern":"handleSubmit","glob":"*.ts"}}                regex search file contents (glob optional)
{"tool":"edit_file","args":{"path":"src/x.ts","old_text":"...","new_text":"..."}} replace old_text (must match exactly once)
{"tool":"write_file","args":{"path":"src/new.ts","content":"..."}}               create or overwrite a file
{"tool":"run_command","args":{"command":"bun test"}}                             run a shell command in the project
{"tool":"finish","args":{"answer":"..."}}                                        final answer for the user (markdown)

Rules:
- Read a file before editing it. Prefer small, surgical edit_file changes over write_file rewrites.
- Match the existing code style. Use relative paths. Never touch files outside the project.
- Verify risky changes with run_command (typecheck, tests) when a quick command exists.
- Answer questions directly from what you read — do not invent file contents.
- When done (or if the task needs no tools), use finish with a clear, concise answer.`;

export class InteractiveAgent {
  private filesChanged = new Set<string>();

  constructor(
    private llm:        LLMAgent,
    private projectDir: string,
    private model:      string,
    private events:     AgentEvents = {},
    private signal?:    AbortSignal,
  ) {}

  async run(request: string, history: LLMMessage[] = []): Promise<AgentRunResult> {
    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT(this.projectDir) },
      ...history,
      { role: 'user', content: request },
    ];

    let answer = '';
    let steps  = 0;

    for (; steps < MAX_STEPS; steps++) {
      if (this.signal?.aborted) throw abortError();

      const resp = await this.llm.call('agent', messages, {
        model: this.model, format: 'json', temperature: 0.2,
      });
      messages.push({ role: 'assistant', content: resp.content });

      let action: ToolAction;
      try {
        action = this.parseAction(resp.content);
      } catch (err: any) {
        messages.push({ role: 'user', content:
          `Your reply was not a valid tool call (${err.message}). Reply with exactly one JSON object using the documented tools.` });
        continue;
      }

      if (action.tool === 'finish') {
        answer = String(action.args?.answer ?? '').trim() || '(no answer)';
        break;
      }

      if (this.signal?.aborted) throw abortError();
      const result = await this.execute(action);
      messages.push({ role: 'user', content: `TOOL RESULT (${action.tool}):\n${result}` });
    }

    if (!answer) {
      answer = 'I ran out of steps before finishing. Here is where I got to — ask me to continue for more.';
    }

    return {
      answer,
      steps,
      filesChanged: [...this.filesChanged],
      totalTokens:  this.llm.getTotalTokens(),
    };
  }

  // ── Action parsing ──────────────────────────────────────────────────────────

  private parseAction(content: string): ToolAction {
    let s = content.trim();
    const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fence) s = fence[1].trim();
    let obj: any;
    try { obj = JSON.parse(s); } catch {
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a === -1 || b <= a) throw new Error('no JSON object found');
      obj = JSON.parse(s.slice(a, b + 1));
    }
    if (typeof obj?.tool !== 'string') throw new Error('missing "tool" field');
    return { tool: obj.tool, args: obj.args ?? {} };
  }

  // ── Tool dispatch ───────────────────────────────────────────────────────────

  private async execute(a: ToolAction): Promise<string> {
    try {
      switch (a.tool) {
        case 'read_file':   return this.toolRead(a.args);
        case 'list_dir':    return this.toolListDir(a.args);
        case 'search':      return this.toolSearch(a.args);
        case 'edit_file':   return this.toolEdit(a.args);
        case 'write_file':  return this.toolWrite(a.args);
        case 'run_command': return await this.toolRun(a.args);
        default:
          return `ERROR: unknown tool "${a.tool}". Use one of: read_file, list_dir, search, edit_file, write_file, run_command, finish.`;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      this.events.onResult?.(`✗ ${err.message}`);
      return `ERROR: ${err.message}`;
    }
  }

  /** Resolve a repo-relative path, refusing anything outside the project. */
  private resolve(rel: string): string {
    const full = path.resolve(this.projectDir, String(rel ?? ''));
    const root = path.resolve(this.projectDir);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`path escapes the project directory: ${rel}`);
    }
    return full;
  }

  private relOf(full: string): string {
    return path.relative(this.projectDir, full).replace(/\\/g, '/');
  }

  // ── Tools ───────────────────────────────────────────────────────────────────

  private toolRead(args: any): string {
    const full  = this.resolve(args.path);
    this.events.onAction?.(`read ${this.relOf(full)}`);
    const text  = fs.readFileSync(full, 'utf-8');
    const lines = text.split('\n');
    const start = Math.max(1, Number(args.start_line) || 1);
    const end   = Math.min(lines.length, Number(args.end_line) || start + MAX_READ_LINES - 1, start + MAX_READ_LINES - 1);
    const slice = lines.slice(start - 1, end)
      .map((l, i) => `${String(start + i).padStart(5)}| ${l}`);
    this.events.onResult?.(`${end - start + 1} of ${lines.length} lines`);
    const more = end < lines.length ? `\n… ${lines.length - end} more lines — request a range to see them.` : '';
    return `${this.relOf(full)} (lines ${start}-${end} of ${lines.length}):\n${slice.join('\n')}${more}`;
  }

  private toolListDir(args: any): string {
    const full = this.resolve(args.path ?? '.');
    this.events.onAction?.(`list ${this.relOf(full) || '.'}`);
    const entries = fs.readdirSync(full, { withFileTypes: true })
      .filter(e => !IGNORED_DIRS.has(e.name))
      .sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name))
      .slice(0, MAX_DIR_ENTRIES)
      .map(e => e.isDirectory() ? e.name + '/' : e.name);
    this.events.onResult?.(`${entries.length} entries`);
    return entries.join('\n') || '(empty)';
  }

  private toolSearch(args: any): string {
    const pattern = String(args.pattern ?? '');
    if (!pattern) throw new Error('search needs a "pattern"');
    this.events.onAction?.(`search /${pattern}/${args.glob ? ' in ' + args.glob : ''}`);
    const re   = new RegExp(pattern, 'i');
    const glob = args.glob ? globToRegExp(String(args.glob)) : null;

    const hits: string[] = [];
    const queue = [this.projectDir];
    while (queue.length && hits.length < MAX_SEARCH_HITS) {
      const dir = queue.shift()!;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (hits.length >= MAX_SEARCH_HITS) break;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!IGNORED_DIRS.has(e.name)) queue.push(full); continue; }
        if (!e.isFile()) continue;
        const rel = this.relOf(full);
        if (glob && !glob.test(rel) && !glob.test(e.name)) continue;
        try {
          if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
          const lines = fs.readFileSync(full, 'utf-8').split('\n');
          for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++) {
            if (re.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
          }
        } catch { /* unreadable/binary */ }
      }
    }
    this.events.onResult?.(`${hits.length} hit${hits.length === 1 ? '' : 's'}`);
    return hits.join('\n') || 'no matches';
  }

  private toolEdit(args: any): string {
    const full = this.resolve(args.path);
    const rel  = this.relOf(full);
    const oldText = String(args.old_text ?? '');
    const newText = String(args.new_text ?? '');
    if (!oldText) throw new Error('edit_file needs non-empty "old_text"');
    this.events.onAction?.(`edit ${rel}`);
    const text  = fs.readFileSync(full, 'utf-8');
    const first = text.indexOf(oldText);
    if (first === -1) throw new Error(`old_text not found in ${rel} — read the file and copy the exact text`);
    if (text.indexOf(oldText, first + 1) !== -1) throw new Error(`old_text matches more than once in ${rel} — include more surrounding context`);
    fs.writeFileSync(full, text.replace(oldText, newText), 'utf-8');
    this.filesChanged.add(rel);
    this.events.onResult?.(`✓ ${rel} updated`);
    return `edited ${rel}: replaced ${oldText.split('\n').length} line(s) with ${newText.split('\n').length} line(s).`;
  }

  private toolWrite(args: any): string {
    const full = this.resolve(args.path);
    const rel  = this.relOf(full);
    const content = String(args.content ?? '');
    const exists  = fs.existsSync(full);
    this.events.onAction?.(`${exists ? 'overwrite' : 'create'} ${rel}`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    this.filesChanged.add(rel);
    this.events.onResult?.(`✓ ${rel} written (${content.split('\n').length} lines)`);
    return `wrote ${rel} (${content.length} chars).`;
  }

  private async toolRun(args: any): Promise<string> {
    const command = String(args.command ?? '').trim();
    if (!command) throw new Error('run_command needs a "command"');
    this.events.onAction?.(`run ${command}`);

    if (this.events.approveCommand) {
      const ok = await this.events.approveCommand(command);
      if (!ok) {
        this.events.onResult?.('denied by user');
        return `Command DENIED by the user. Do not retry it — continue another way or finish.`;
      }
    }

    const shell = process.platform === 'win32' ? ['cmd', '/c', command] : ['sh', '-c', command];
    const proc  = Bun.spawn(shell, { cwd: this.projectDir, stdout: 'pipe', stderr: 'pipe' });
    const killer = setTimeout(() => { try { proc.kill(); } catch { /* already dead */ } }, CMD_TIMEOUT_MS);
    const onAbort = () => { try { proc.kill(); } catch { /* already dead */ } };
    this.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const merged = (out + (err ? '\n' + err : '')).trim();
      const tail   = merged.length > MAX_CMD_OUTPUT
        ? '… (truncated)\n' + merged.slice(-MAX_CMD_OUTPUT) : merged;
      this.events.onResult?.(code === 0 ? '✓ exit 0' : `✗ exit ${code}`);
      return `exit code ${code}\n${tail || '(no output)'}`;
    } finally {
      clearTimeout(killer);
      this.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§').replace(/\*/g, '[^/]*').replace(/§§/g, '.*').replace(/\?/g, '.');
  return new RegExp(`(^|/)${escaped}$`, 'i');
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}
