// ── SOPHOS v3.0 Command Registry ──────────────────────────────────────────────
// All slash commands for both legacy compatibility and new v3.0 features.

import * as fs   from 'node:fs';
import * as path from 'node:path';
import { ui, c, formatDuration } from './ui.js';
import type { SessionManager }  from './session.js';
import type { CostTracker }     from './cost-tracker.js';
import type { ModelSelector }   from './model-selector.js';
import type { GitIntegration }  from './git-integration.js';
import type { PermissionSystem }from './permissions.js';
import { loadPipelineState, clearPipelineState, formatPipelineState } from './pipeline-state.js';

export interface CommandContext {
  session:         SessionManager;
  costTracker:     CostTracker;
  modelSelector:   ModelSelector;
  git:             GitIntegration;
  permissions:     PermissionSystem;
  projectDir:      string;
  planMode:        boolean;
  setPlanMode:     (mode: boolean) => void;
  streamOutput:    boolean;
  setStreamOutput: (on: boolean) => void;
  compactAuto:     boolean;
  setCompactAuto:  (on: boolean) => void;
}

export interface SlashCommand {
  name:        string;
  aliases:     string[];
  description: string;
  usage:       string;
  execute:     (args: string[], ctx: CommandContext) => Promise<void>;
}

// ── Diff renderer ─────────────────────────────────────────────────────────────
function renderDiff(diff: string, _ctx: CommandContext): void {
  const files = diff.split(/^diff --git/m).filter(Boolean);
  for (const fileDiff of files) {
    const nameMatch = fileDiff.match(/a\/(.+?) b\//);
    const fileName  = nameMatch?.[1] ?? 'unknown';
    const addCount  = (fileDiff.match(/^\+(?!\+\+)/mg) ?? []).length;
    const delCount  = (fileDiff.match(/^-(?!--)/mg)    ?? []).length;

    // File header
    console.log(`\n  ${c.accent.bold(fileName)}  ${c.success(`+${addCount}`)} ${c.error(`-${delCount}`)}`);
    console.log('  ' + c.dim('─'.repeat(Math.min(60, (process.stdout.columns || 80) - 4))));

    // Hunks (up to 40 lines per file)
    const lines = fileDiff.split('\n').slice(0, 40);
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff') || line.startsWith('index')) continue;
      if (line.startsWith('+'))      console.log('  ' + c.success(line));
      else if (line.startsWith('-')) console.log('  ' + c.error(line));
      else if (line.startsWith('@@')) console.log('  ' + c.info(line));
      else                            console.log('  ' + c.dim(line));
    }
  }
  if (!files.length) console.log(`\n  ${c.muted('No changes.')}\n`);
}

// ── Registry ──────────────────────────────────────────────────────────────────
export function getSlashCommands(): SlashCommand[] {
  return [

    // ── /help ────────────────────────────────────────────────────────────────
    {
      name: 'help', aliases: ['h', '?'], description: 'Show all commands', usage: '/help [command]',
      execute: async (args, _ctx) => {
        const cmds = getSlashCommands();
        if (args.length > 0) {
          const cmd = cmds.find(c => c.name === args[0] || c.aliases.includes(args[0]));
          if (cmd) {
            console.log(`\n  ${c.primary.bold('/' + cmd.name)} — ${cmd.description}`);
            console.log(`  ${c.muted('Usage:')} ${cmd.usage}`);
            if (cmd.aliases.length) console.log(`  ${c.muted('Aliases:')} ${cmd.aliases.map(a => '/' + a).join(', ')}`);
          } else {
            console.log(`\n  ${c.error('Unknown command:')} /${args[0]}`);
          }
        } else {
          const { helpPanel } = await import('./ui.js');
          console.log(helpPanel());
        }
      },
    },

    // ── /models (v3.0) ───────────────────────────────────────────────────────
    {
      name: 'models', aliases: ['model', 'm'], description: 'View or change AI models', usage: '/models [set|small|large|suggest|save|wizard]',
      execute: async (args, ctx) => {
        const sub = args[0];

        // /models  (no args) — show full status
        if (!sub) {
          console.log(ctx.modelSelector.formatModelList());
          return;
        }

        switch (sub) {

          // /models list — explicit model list
          case 'list':
            console.log(ctx.modelSelector.formatModelList());
            break;

          // /models set <name> — set medium model
          case 'set':
            if (!args[1]) { console.log(`\n  ${c.error('Usage:')} /models set <model-name>\n`); return; }
            ctx.modelSelector.setCurrentModel(args[1]);
            console.log(`\n  ${c.success('✓')} Medium model: ${c.accent(args[1])}\n`);
            break;

          // /models small <name>
          case 'small':
            if (!args[1]) { console.log(`\n  ${c.error('Usage:')} /models small <model-name>\n`); return; }
            ctx.modelSelector.setSmallModel(args[1]);
            console.log(`\n  ${c.success('✓')} Small model: ${c.accent(args[1])}\n`);
            break;

          // /models large <name>
          case 'large':
            if (!args[1]) { console.log(`\n  ${c.error('Usage:')} /models large <model-name>\n`); return; }
            ctx.modelSelector.setLargeModel(args[1]);
            console.log(`\n  ${c.success('✓')} Large model: ${c.accent(args[1])}\n`);
            break;

          // /models suggest — show download recommendations
          case 'suggest':
          case 'download':
          case 'setup':
            ctx.modelSelector.printDownloadGuide();
            break;

          // /models wizard — interactive setup
          case 'wizard':
            await ctx.modelSelector.runSetupWizard('local');
            break;

          // /models save [local|global]
          case 'save': {
            const scope = (args[1] === 'global') ? 'global' : 'local';
            if (scope === 'global') {
              ctx.modelSelector.saveGlobal();
              const { getGlobalConfigPath } = await import('../config/config.js');
              console.log(`\n  ${c.success('✓')} Saved to global config: ${c.muted(getGlobalConfigPath())}\n`);
            } else {
              ctx.modelSelector.saveLocal(ctx.projectDir);
              console.log(`\n  ${c.success('✓')} Saved to ${c.dim('.sophos/config.json')} in ${c.muted(ctx.projectDir)}\n`);
            }
            break;
          }

          // /models offline — show Ollama install guide
          case 'offline':
          case 'install':
            ctx.modelSelector.printOllamaOffline();
            break;

          // /models <name> — shorthand for set
          default:
            ctx.modelSelector.setCurrentModel(sub);
            console.log(`\n  ${c.success('✓')} Medium model: ${c.accent(sub)}\n`);
            break;
        }
      },
    },

    // ── /agents (v3.0) ───────────────────────────────────────────────────────
    {
      name: 'agents', aliases: ['agent'], description: 'Monitor active agents', usage: '/agents',
      execute: async (_args, _ctx) => {
        // In the current architecture agents are ephemeral per pipeline run.
        // Show a reference table of the agent roles.
        const rows: [string, string, string][] = [
          ['repository-analyzer', 'small',  'Scans codebase, builds context package'],
          ['planner (×8)',        'large',  'Parallel planning swarm'],
          ['synthesizer',         'large',  'Merges planner outputs'],
          ['execution-planner',   'medium', 'Builds task graph'],
          ['coding-agent',        'medium', 'Generates code per task'],
          ['reviewer (×5)',       'medium', 'Code review + consensus'],
          ['security-agent (×6)', 'large',  'CWE / CVE analysis'],
          ['integration-manager', 'small',  'Patches + integrity check'],
          ['final-qa',            'medium', 'End-to-end QA gates'],
        ];
        console.log(`\n  ${c.accent.bold('Agent Roster')}\n`);
        console.log(`  ${c.muted('Role'.padEnd(26))}  ${c.muted('Tier'.padEnd(8))}  ${c.muted('Purpose')}`);
        console.log(`  ${'─'.repeat(70)}`);
        for (const [role, tier, purpose] of rows) {
          const tierColor = tier === 'large' ? c.warning : tier === 'medium' ? c.primary : c.muted;
          console.log(`  ${c.text(role.padEnd(26))}  ${tierColor(tier.padEnd(8))}  ${c.muted(purpose)}`);
        }
        console.log('');
      },
    },

    // ── /tasks (v3.0) ────────────────────────────────────────────────────────
    {
      name: 'tasks', aliases: ['task'], description: 'View task queue and history', usage: '/tasks',
      execute: async (_args, ctx) => {
        const todoPath = path.join(ctx.projectDir, '.sophos-todo.json');
        if (!fs.existsSync(todoPath)) {
          console.log(`\n  ${c.muted('No task history yet. Run a pipeline first.')}\n`);
          return;
        }
        try {
          const todos = JSON.parse(fs.readFileSync(todoPath, 'utf-8'));
          console.log(`\n  ${c.accent.bold('Task Queue')}\n`);
          for (const t of todos) {
            const icon = t.done ? c.success('✅') : c.warning('⏳');
            console.log(`  ${icon}  ${t.id}. ${t.done ? c.muted(t.text) : c.text(t.text)}`);
          }
          console.log('');
        } catch {
          console.log(`\n  ${c.error('Failed to read task history.')}\n`);
        }
      },
    },

    // ── /security (v3.0) ─────────────────────────────────────────────────────
    {
      name: 'security', aliases: ['sec'], description: 'Show last security scan results', usage: '/security',
      execute: async (_args, ctx) => {
        const scanPath = path.join(ctx.projectDir, '.sophos-security.json');
        if (!fs.existsSync(scanPath)) {
          console.log(`\n  ${c.muted('No security scan results found. Run a pipeline first.')}\n`);
          return;
        }
        try {
          const findings = JSON.parse(fs.readFileSync(scanPath, 'utf-8'));
          if (!findings.length) {
            console.log(`\n  ${c.success('✓ Clean')} — No security findings.\n`);
            return;
          }
          console.log(`\n  ${c.accent.bold('Security Findings')}\n`);
          for (const f of findings) {
            const sev = f.severity === 'critical' ? c.error
              : f.severity === 'high'     ? c.error
              : f.severity === 'medium'   ? c.warning
              : c.muted;
            console.log(`  ${sev(f.severity.toUpperCase().padEnd(8))}  ${c.muted(f.cwe)}  ${c.text(f.description.slice(0, 60))}`);
          }
          console.log('');
        } catch {
          console.log(`\n  ${c.error('Failed to read security results.')}\n`);
        }
      },
    },

    // ── /rollback (v3.0) ─────────────────────────────────────────────────────
    {
      name: 'rollback', aliases: [], description: 'Revert to pre-pipeline state', usage: '/rollback [--hard]',
      execute: async (args, ctx) => {
        const hard = args.includes('--hard');
        console.log(`\n  ${c.warning(`⚠  Rolling back${hard ? ' (hard)' : ' (stash)'}...`)}`);
        try {
          const log = await ctx.git.getLog(1);
          if (!log.length) { console.log(`  ${c.muted('Nothing to roll back.')}\n`); return; }
          console.log(`  ${c.muted('Last commit:')} ${c.accent(log[0].hash.slice(0, 8))} ${log[0].message}`);
          if (hard) {
            // Warn before a destructive action
            console.log(`  ${c.error('Note: --hard discards all uncommitted changes. Stashing instead to be safe.')}`);
          }
          const ok = await ctx.git.stash();
          console.log(ok
            ? `  ${c.success('✓')} Changes stashed. Run ${c.accent('/git stash pop')} to restore.\n`
            : `  ${c.error('✗')} Stash failed.\n`
          );
        } catch (err: any) {
          console.log(`  ${c.error('✗')} Rollback error: ${err.message}\n`);
        }
      },
    },

    // ── /diff ────────────────────────────────────────────────────────────────
    {
      name: 'diff', aliases: ['d'], description: 'Show git diff', usage: '/diff [file]',
      execute: async (args, ctx) => {
        const diff = await ctx.git.getDiff(args[0]);
        if (!diff) { console.log(`\n  ${c.muted('No changes.')}\n`); return; }
        renderDiff(diff, ctx);
      },
    },

    // ── /git ─────────────────────────────────────────────────────────────────
    {
      name: 'git', aliases: ['g'], description: 'Git: status, log, commit, branch, stash, diff', usage: '/git [subcommand] [args]',
      execute: async (args, ctx) => {
        const sub     = args[0] || 'status';
        const subArgs = args.slice(1);
        switch (sub) {
          case 'status': {
            const info = await ctx.git.getInfo();
            if (!info.isRepo) { console.log(`\n  ${c.warning('Not a git repository.')}\n`); return; }
            console.log(ui.sectionHeader('Git Status'));
            console.log('  ' + ctx.git.formatStatus(info).split('\n').join('\n  '));
            console.log(ui.sectionFooter());
            break;
          }
          case 'log': {
            const commits = await ctx.git.getLog(parseInt(subArgs[0]) || 10);
            console.log(ui.sectionHeader('Recent Commits'));
            commits.forEach(cm => console.log(`  ${c.accent(cm.hash.slice(0,8))} ${c.muted(cm.message.slice(0, 60))}`));
            console.log(ui.sectionFooter());
            break;
          }
          case 'commit': {
            if (!subArgs.length) { console.log(`\n  ${c.error('Usage:')} /git commit <message>`); return; }
            const hash = await ctx.git.commit(subArgs.join(' '));
            console.log(hash
              ? `\n  ${c.success('✓')} Committed: ${c.accent(hash.slice(0,8))}\n`
              : `\n  ${c.error('✗')} Commit failed\n`
            );
            break;
          }
          case 'branch': {
            if (subArgs.length) {
              await ctx.git.createBranch(subArgs[0]);
              console.log(`\n  ${c.success('✓')} Created branch: ${c.accent(subArgs[0])}\n`);
            } else {
              const info = await ctx.git.getInfo();
              console.log(`\n  Current: ${c.accent(info.branch)}\n`);
            }
            break;
          }
          case 'stash': {
            const ok = subArgs[0] === 'pop' ? await ctx.git.stashPop() : await ctx.git.stash();
            console.log(ok ? `\n  ${c.success('✓')} Done\n` : `\n  ${c.error('✗')} Failed\n`);
            break;
          }
          case 'diff': {
            const diff = await ctx.git.getDiff(subArgs[0]);
            if (!diff) { console.log(`\n  ${c.muted('No changes.')}\n`); return; }
            renderDiff(diff, ctx);
            break;
          }
          default:
            console.log(`\n  ${c.error('Unknown:')} ${sub}  ${c.muted('— use: status, log, commit, branch, stash, diff')}\n`);
        }
      },
    },

    // ── /plan ────────────────────────────────────────────────────────────────
    {
      name: 'plan', aliases: [], description: 'Toggle plan mode (no file changes)', usage: '/plan [on|off]',
      execute: async (args, ctx) => {
        if (args[0] === 'on') ctx.setPlanMode(true);
        else if (args[0] === 'off') ctx.setPlanMode(false);
        else ctx.setPlanMode(!ctx.planMode);
        console.log(`\n  Plan mode: ${ctx.planMode ? c.warning('ON  — analysis only, no writes') : c.success('OFF — full pipeline')}\n`);
      },
    },

    // ── /compact ─────────────────────────────────────────────────────────────
    {
      name: 'compact', aliases: ['c'], description: 'Compact conversation context', usage: '/compact',
      execute: async (_args, ctx) => {
        const before = ctx.session.getTokenEstimate();
        console.log(`\n  ${c.muted('Tokens before:')} ${c.primary(ui.formatNumber(before))}`);
        const result = await ctx.session.compact();
        console.log(`  ${c.muted('Messages removed:')} ${c.warning(String(result.messagesRemoved))}`);
        console.log(`  ${c.muted('Tokens saved:   ')} ${c.success(ui.formatNumber(result.tokensSaved))}\n`);
      },
    },

    // ── /cost ─────────────────────────────────────────────────────────────────
    {
      name: 'cost', aliases: [], description: 'View token usage and costs', usage: '/cost',
      execute: async (_args, ctx) => { console.log('\n' + ctx.costTracker.formatSummary()); },
    },

    // ── /review ──────────────────────────────────────────────────────────────
    {
      name: 'review', aliases: [], description: 'Review current changes', usage: '/review',
      execute: async (_args, ctx) => {
        const status = await ctx.git.getInfo();
        if (status.isClean) { console.log(`\n  ${c.muted('No changes.')}\n`); return; }
        console.log(ui.sectionHeader('Change Review'));
        const all = [...(status.staged || []), ...(status.modified || []), ...(status.notAdded || [])];
        console.log(`  ${c.muted('Files:')} ${c.primary(String(all.length))}`);
        all.slice(0, 20).forEach(f => console.log(`  ${c.dim('•')} ${f}`));
        console.log(ui.sectionFooter());
      },
    },

    // ── /inspect ─────────────────────────────────────────────────────────────
    {
      name: 'inspect', aliases: ['i'], description: 'Inspect file or directory', usage: '/inspect <path>',
      execute: async (args, ctx) => {
        if (!args.length) { console.log(`\n  ${c.error('Usage:')} /inspect <path>\n`); return; }
        const target = path.resolve(ctx.projectDir, args[0]);
        try {
          const stat = fs.statSync(target);
          if (stat.isDirectory()) {
            const entries = fs.readdirSync(target);
            console.log(ui.sectionHeader(`Directory: ${args[0]}`));
            entries.slice(0, 30).forEach(e => {
              const isDir = fs.statSync(path.join(target, e)).isDirectory();
              console.log(`  ${isDir ? c.primary('📁') : c.muted('📄')} ${e}`);
            });
            if (entries.length > 30) console.log(c.muted(`  … ${entries.length - 30} more`));
            console.log(ui.sectionFooter());
          } else {
            const content = fs.readFileSync(target, 'utf-8');
            const lines   = content.split('\n');
            console.log(ui.sectionHeader(`${args[0]}  (${lines.length} lines)`));
            lines.slice(0, 50).forEach((l, i) =>
              console.log(`  ${c.muted(String(i + 1).padStart(4))}  ${l}`)
            );
            if (lines.length > 50) console.log(c.muted(`  … ${lines.length - 50} more`));
            console.log(ui.sectionFooter());
          }
        } catch { console.log(`\n  ${c.error('Not found:')} ${args[0]}\n`); }
      },
    },

    // ── /todo ─────────────────────────────────────────────────────────────────
    {
      name: 'todo', aliases: [], description: 'Manage local task list', usage: '/todo [add|list|done|clear] [task]',
      execute: async (args, ctx) => {
        const todoPath = path.join(ctx.projectDir, '.sophos-todo.json');
        let todos: { id: number; text: string; done: boolean }[] = [];
        if (fs.existsSync(todoPath)) try { todos = JSON.parse(fs.readFileSync(todoPath, 'utf-8')); } catch { /* */ }
        const action = args[0] || 'list';
        switch (action) {
          case 'add': {
            const text = args.slice(1).join(' ');
            if (!text) { console.log(`\n  ${c.error('Usage:')} /todo add <task>\n`); return; }
            todos.push({ id: todos.length + 1, text, done: false });
            fs.writeFileSync(todoPath, JSON.stringify(todos, null, 2));
            console.log(`\n  ${c.success('✓')} Added: ${text}\n`);
            break;
          }
          case 'list': {
            if (!todos.length) { console.log(`\n  ${c.muted('No tasks.')}\n`); return; }
            console.log(ui.sectionHeader('Tasks'));
            todos.forEach(t => console.log(`  ${t.done ? c.success('✓') : c.warning('○')} ${t.id}. ${t.done ? c.muted(t.text) : t.text}`));
            console.log(ui.sectionFooter());
            break;
          }
          case 'done': {
            const t = todos.find(tt => tt.id === parseInt(args[1]));
            if (t) { t.done = true; fs.writeFileSync(todoPath, JSON.stringify(todos, null, 2)); console.log(`\n  ${c.success('✓')} Done: ${t.text}\n`); }
            else console.log(`\n  ${c.error('Not found:')} ${args[1]}\n`);
            break;
          }
          case 'clear': {
            todos = todos.filter(t => !t.done);
            fs.writeFileSync(todoPath, JSON.stringify(todos, null, 2));
            console.log(`\n  ${c.success('✓')} Cleared completed tasks.\n`);
            break;
          }
          default:
            console.log(`\n  ${c.error('Unknown action:')} ${action}  ${c.muted('— use: add, list, done, clear')}\n`);
        }
      },
    },

    // ── /notifications ────────────────────────────────────────────────────────
    {
      name: 'notifications', aliases: ['notif', 'n'], description: 'View notification tray', usage: '/notifications [clear]',
      execute: async (args, _ctx) => {
        const { tray } = await import('./notification-tray.js');
        if (args[0] === 'clear') { tray.dismissAll(); console.log(`\n  ${c.success('✓')} Notifications cleared.\n`); }
        else tray.showFull();
      },
    },

    // ── /stream ───────────────────────────────────────────────────────────────
    {
      name: 'stream', aliases: [], description: 'Toggle streaming output', usage: '/stream [on|off]',
      execute: async (args, ctx) => {
        if (args[0] === 'on') ctx.setStreamOutput(true);
        else if (args[0] === 'off') ctx.setStreamOutput(false);
        else ctx.setStreamOutput(!ctx.streamOutput);
        console.log(`\n  Streaming: ${ctx.streamOutput ? c.success('ON') : c.warning('OFF')}\n`);
      },
    },

    // ── /clear ────────────────────────────────────────────────────────────────
    {
      name: 'clear', aliases: ['cls'], description: 'Clear screen and conversation', usage: '/clear',
      execute: async (_args, ctx) => {
        ctx.session.clear();
        process.stdout.write('\x1Bc');
        const { banner: b } = await import('./ui.js');
        console.log(b());
        console.log(c.muted('  Conversation cleared.\n'));
      },
    },

    // ── /export ───────────────────────────────────────────────────────────────
    {
      name: 'export', aliases: [], description: 'Export session history', usage: '/export [filename]',
      execute: async (args, ctx) => {
        const fp = ctx.session.saveSession(args[0]);
        console.log(`\n  ${c.success('✓')} Saved: ${c.accent(fp)}\n`);
      },
    },

    // ── /permissions ──────────────────────────────────────────────────────────
    {
      name: 'permissions', aliases: ['perm'], description: 'View permission rules', usage: '/permissions',
      execute: async (_args, ctx) => {
        console.log(ui.sectionHeader('Permissions'));
        ctx.permissions.getSummary().forEach(l => console.log(`  ${l}`));
        console.log(ui.sectionFooter());
      },
    },

    // ── /auto-compact ─────────────────────────────────────────────────────────
    {
      name: 'auto-compact', aliases: ['ac'], description: 'Toggle auto-compaction', usage: '/auto-compact [on|off]',
      execute: async (args, ctx) => {
        if (args[0] === 'on') ctx.setCompactAuto(true);
        else if (args[0] === 'off') ctx.setCompactAuto(false);
        else ctx.setCompactAuto(!ctx.compactAuto);
        console.log(`\n  Auto-compact: ${ctx.compactAuto ? c.success('ON') : c.warning('OFF')}\n`);
      },
    },

    // ── /resume ──────────────────────────────────────────────────────────────
    {
      name: 'resume', aliases: ['r'], description: 'Resume last interrupted pipeline', usage: '/resume',
      execute: async (_args, ctx) => {
        const state = loadPipelineState();
        if (!state) {
          console.log(`\n  ${c.muted('No pipeline to resume. Run a pipeline first.')}\n`);
          return;
        }
        console.log(`\n  ${c.accent.bold('Last Pipeline')}`);
        console.log('  ' + formatPipelineState(state).split('\n').join('\n  '));
        console.log('');
        console.log(`  ${c.dim('To re-run:')} ${c.primary(state.request)}`);
        console.log('');
      },
    },

    // ── /sessions ─────────────────────────────────────────────────────────────
    {
      name: 'sessions', aliases: [], description: 'List saved sessions', usage: '/sessions',
      execute: async (_args, ctx) => {
        const sessions = ctx.session.listSessions();
        if (!sessions.length) { console.log(`\n  ${c.muted('No saved sessions.')}\n`); return; }
        console.log(ui.sectionHeader('Sessions'));
        sessions.forEach(s => console.log(`  ${c.dim('•')} ${s}`));
        console.log(ui.sectionFooter());
        console.log(`  ${c.dim('Project sessions in')} ${c.muted('.sophos/sessions/')}`);
        console.log('');
      },
    },

    // ── /exit ─────────────────────────────────────────────────────────────────
    {
      name: 'exit', aliases: ['quit', 'q'], description: 'Quit SOPHOS', usage: '/exit',
      execute: async () => {
        console.log(`\n  ${c.muted('Goodbye! 👋')}\n`);
        process.exit(0);
      },
    },

    // ── /webui ───────────────────────────────────────────────────────────────
    {
      name: 'webui', aliases: [], description: 'Start WebUI server', usage: '/webui [port]',
      execute: async (args, ctx) => {
        const port = parseInt(args[0]) || 3777;
        const { WebUIServer } = await import('../webui/server.js');
        const server = new WebUIServer({
          port,
          host: '0.0.0.0',
          targetDir: ctx.projectDir,
        });
        await server.start();
      },
    },

    // ── /mcp ─────────────────────────────────────────────────────────────────
    {
      name: 'mcp', aliases: [], description: 'Start MCP server (stdio)', usage: '/mcp',
      execute: async (_args, ctx) => {
        const { MCPServer } = await import('../mcp/server.js');
        const server = new MCPServer(ctx.projectDir);
        server.start();
        console.log(`\n  ${c.success('✓')} MCP server started on stdio\n`);
      },
    },

    // ── /tunnel ──────────────────────────────────────────────────────────────
    {
      name: 'tunnel', aliases: [], description: 'Expose port via tunnel', usage: '/tunnel [port] [provider]',
      execute: async (args, ctx) => {
        const port     = parseInt(args[0]) || 3777;
        const provider = (args[1] || 'auto') as any;
        const { startTunnel } = await import('../tunnel/tunnel.js');
        try {
          await startTunnel({ port, provider });
        } catch (err: any) {
          console.log(`\n  ${c.error('Tunnel failed:')} ${err.message}\n`);
        }
      },
    },

    // ── /config ───────────────────────────────────────────────────────────────
    {
      name: 'config', aliases: [], description: 'Show project configuration', usage: '/config',
      execute: async (_args, ctx) => {
        const { ProjectStore } = await import('../config/project-store.js');
        const store = new ProjectStore(ctx.projectDir);
        const projectCfg = path.join(ctx.projectDir, '.sophos', 'config.json');
        const legacyCfg  = path.join(ctx.projectDir, '.sophos.json');

        if (fs.existsSync(projectCfg)) {
          const raw = fs.readFileSync(projectCfg, 'utf-8');
          console.log(ui.sectionHeader('.sophos/config.json'));
          raw.split('\n').slice(0, 40).forEach((l, i) => console.log(`  ${c.muted(String(i + 1).padStart(3))}  ${l}`));
          console.log(ui.sectionFooter());
        } else if (fs.existsSync(legacyCfg)) {
          const raw = fs.readFileSync(legacyCfg, 'utf-8');
          console.log(ui.sectionHeader('.sophos.json (legacy)'));
          raw.split('\n').slice(0, 40).forEach((l, i) => console.log(`  ${c.muted(String(i + 1).padStart(3))}  ${l}`));
          console.log(ui.sectionFooter());
          console.log(`  ${c.dim('Tip:')} Run ${c.primary('/config init')} to migrate to .sophos/\n`);
        } else {
          console.log(`\n  ${c.muted('No project config found. Using defaults.')}\n`);
        }
      },
    },

    // ── /config init ──────────────────────────────────────────────────────────
    {
      name: 'config-init', aliases: [], description: 'Initialize .sophos/ directory', usage: '/config init',
      execute: async (_args, ctx) => {
        const { ProjectStore } = await import('../config/project-store.js');
        const store = new ProjectStore(ctx.projectDir);
        store.init();

        // Migrate legacy .sophos.json if it exists
        const legacyCfg = path.join(ctx.projectDir, '.sophos.json');
        if (fs.existsSync(legacyCfg) && !fs.existsSync(store.paths.config)) {
          const raw = fs.readFileSync(legacyCfg, 'utf-8');
          fs.writeFileSync(store.paths.config, raw, 'utf-8');
          console.log(`\n  ${c.success('✓')} Migrated ${c.dim('.sophos.json')} → ${c.dim('.sophos/config.json')}`);
        }

        console.log(`\n  ${c.success('✓')} Initialized ${c.dim('.sophos/')} directory`);
        console.log(store.formatSummary());
        console.log('');
      },
    },

    // ── /status ───────────────────────────────────────────────────────────────
    {
      name: 'status', aliases: ['st'], description: 'Show project store status', usage: '/status',
      execute: async (_args, ctx) => {
        const { ProjectStore } = await import('../config/project-store.js');
        const store = new ProjectStore(ctx.projectDir);

        console.log(ui.sectionHeader('Project Status'));
        console.log(store.formatSummary());
        console.log('');

        // Show active models
        const model = ctx.modelSelector.getCurrentModel();
        const small = ctx.modelSelector.getSmallModel();
        const large = ctx.modelSelector.getLargeModel();
        console.log(`  ${c.accent.bold('Models')}`);
        console.log(`  ${c.muted('Small: ')} ${small || c.warning('not set')}`);
        console.log(`  ${c.muted('Medium:')} ${model || c.warning('not set')}`);
        console.log(`  ${c.muted('Large: ')} ${large || c.warning('not set')}`);
        console.log('');

        // Show pipeline state if any
        const { loadPipelineState } = await import('./pipeline-state.js');
        const state = loadPipelineState();
        if (state) {
          const elapsed = state.completedAt
            ? state.completedAt - state.startedAt
            : Date.now() - state.startedAt;
          const status = state.success === true ? c.success('completed')
            : state.success === false ? c.error('failed')
            : c.warning('interrupted');
          console.log(`  ${c.accent.bold('Last Pipeline')}`);
          console.log(`  ${c.muted('Request:')} ${c.text(state.request.slice(0, 60))}`);
          console.log(`  ${c.muted('Status: ')} ${status}`);
          console.log(`  ${c.muted('Elapsed:')} ${formatDuration(elapsed)}`);
          console.log('');
        }

        console.log(ui.sectionFooter());
      },
    },

  ];
}

// ── Lookup ────────────────────────────────────────────────────────────────────
export function findCommand(input: string): { command: SlashCommand; args: string[]; commandArgs?: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  const name  = parts[0];
  const args  = parts.slice(1);
  const cmds  = getSlashCommands();
  const cmd   = cmds.find(c => c.name === name || c.aliases.includes(name));
  return cmd ? { command: cmd, args, commandArgs: args } : null;
}
