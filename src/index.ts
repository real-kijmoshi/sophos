#!/usr/bin/env bun

import * as path from 'node:path';
import * as fs   from 'node:fs';
import pkg from '../package.json';
import { SophosREPL }                           from './cli/repl.js';
import { Orchestrator }                         from './orchestrator.js';
import { loadConfig, getDefaultConfigPath }     from './config/config.js';
import { banner, statusBar, helpPanel, c, ui }  from './cli/ui.js';
import type { OrchestratorConfig }              from './types.js';

interface CLIOptions {
  mode:        'interactive' | 'batch' | 'webui' | 'mcp';
  targetDir:   string;
  request:     string;
  model:       string;
  smallModel:  string;
  largeModel:  string;
  configPath:  string | undefined;
  verbose:     boolean;
  dryRun:      boolean;
  planMode:    boolean;
  maxReviews:  number;
  maxRepairs:  number;
  ollamaUrl:   string | undefined;
  version:     boolean;
  webuiPort:   number;
  tunnel:      boolean;
  tunnelProvider: string;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    mode: 'interactive', targetDir: process.cwd(), request: '',
    model: '', smallModel: '', largeModel: '',
    configPath: undefined, verbose: false, dryRun: false, planMode: false,
    maxReviews: 3, maxRepairs: 2, ollamaUrl: undefined, version: false,
    webuiPort: 3777, tunnel: false, tunnelProvider: 'auto',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--target':   case '-t': opts.targetDir  = path.resolve(args[++i]); break;
      case '--request':  case '-r': opts.request    = args[++i]; opts.mode = 'batch'; break;
      case '--config':   case '-c': opts.configPath = path.resolve(args[++i]); break;
      case '--model':    case '-m': opts.model      = args[++i]; break;
      case '--model-small':         opts.smallModel = args[++i]; break;
      case '--model-medium':        opts.model      = args[++i]; break;
      case '--model-large':         opts.largeModel = args[++i]; break;
      case '--ollama-url':          opts.ollamaUrl  = args[++i]; break;
      case '--plan':     case '-p': opts.planMode   = true;      break;
      case '--verbose':  case '-v': opts.verbose    = true;      break;
      case '--dry-run':  case '-d': opts.dryRun     = true;      break;
      case '--max-reviews':         opts.maxReviews = parseInt(args[++i]) || 3; break;
      case '--max-repairs':         opts.maxRepairs = parseInt(args[++i]) || 2; break;
      case '--version':             opts.version    = true;      break;
      case '--webui':               opts.mode = 'webui';         break;
      case '--mcp':                 opts.mode = 'mcp';           break;
      case '--webui-port':          opts.webuiPort = parseInt(args[++i]) || 3777; break;
      case '--tunnel':              opts.tunnel = true;           break;
      case '--tunnel-provider':     opts.tunnelProvider = args[++i] || 'auto'; break;
      case '--help':     case '-h': printHelp(); process.exit(0);
    }
  }

  // Positional argument → batch mode
  if (!opts.request) {
    const positional = args.filter(a => !a.startsWith('-'));
    if (positional.length > 0) { opts.request = positional.join(' '); opts.mode = 'batch'; }
  }

  if (opts.ollamaUrl)  process.env.SOPHOS_OLLAMA_URL    = opts.ollamaUrl;
  if (opts.model)      process.env.SOPHOS_MODEL_MEDIUM  = opts.model;
  if (opts.smallModel) process.env.SOPHOS_MODEL_SMALL   = opts.smallModel;
  if (opts.largeModel) process.env.SOPHOS_MODEL_LARGE   = opts.largeModel;

  return opts;
}

function printHelp(): void {
  console.log(banner({ version: pkg.version }));
  console.log(helpPanel(pkg.version));
  console.log(`
  ${c.accent.bold('CLI OPTIONS')}
    ${c.primary('-t, --target')} <dir>       ${c.muted('Target directory (default: cwd)')}
    ${c.primary('-r, --request')} <text>     ${c.muted('User request — triggers batch mode')}
    ${c.primary('-c, --config')} <path>      ${c.muted('Config file path')}
    ${c.primary('-m, --model')} <model>      ${c.muted('Medium model override')}
    ${c.primary('--model-small')} <model>    ${c.muted('Small model for quick tasks')}
    ${c.primary('--model-large')} <model>    ${c.muted('Large model for complex reasoning')}
    ${c.primary('--ollama-url')} <url>       ${c.muted('Ollama server URL')}
    ${c.primary('-p, --plan')}               ${c.muted('Plan mode — analysis only, no file changes')}
    ${c.primary('-d, --dry-run')}            ${c.muted('Dry run — skip code generation')}
    ${c.primary('-v, --verbose')}            ${c.muted('Verbose output')}
    ${c.primary('--version')}               ${c.muted('Show version')}
    ${c.primary('-h, --help')}              ${c.muted('Show this help')}
    ${c.primary('--webui')}                 ${c.muted('Start WebUI server (browser interface)')}
    ${c.primary('--webui-port')} <port>     ${c.muted('WebUI port (default: 3777)')}
    ${c.primary('--mcp')}                   ${c.muted('Start MCP server (stdio transport)')}
    ${c.primary('--tunnel')}                ${c.muted('Expose WebUI via tunnel (cloudflared/localtunnel/ngrok)')}
    ${c.primary('--tunnel-provider')} <p>   ${c.muted('Tunnel provider: cloudflared, localtunnel, ngrok, auto')}

  ${c.accent.bold('EXAMPLES')}
    ${c.primary('sophos')}                                       ${c.muted('Start interactive REPL')}
    ${c.primary('sophos')} ${c.secondary('"add user authentication"')}              ${c.muted('Batch mode — run full pipeline')}
    ${c.primary('sophos')} ${c.secondary('-t ./api')} ${c.secondary('"refactor auth middleware"')}  ${c.muted('Target specific dir')}
    ${c.primary('sophos')} ${c.secondary('--plan "add rate limiting"')}             ${c.muted('Plan only, no changes')}
    ${c.primary('sophos')} ${c.secondary('--webui')}                               ${c.muted('Start WebUI on port 3777')}
    ${c.primary('sophos')} ${c.secondary('--webui --tunnel')}                      ${c.muted('WebUI + public tunnel URL')}
    ${c.primary('sophos')} ${c.secondary('--mcp')}                                ${c.muted('Start MCP server for AI tool integration')}
`);
}

async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.version) {
    console.log('sophos v3.0.0');
    process.exit(0);
  }

  if (!fs.existsSync(opts.targetDir)) {
    console.error(`Error: Target directory not found: ${opts.targetDir}`);
    process.exit(1);
  }

  if (opts.mode === 'batch') {
    await runBatchMode(opts);
  } else if (opts.mode === 'webui') {
    await runWebUIMode(opts);
  } else if (opts.mode === 'mcp') {
    await runMCPMode(opts);
  } else {
    await runInteractiveMode(opts);
  }
}

async function runInteractiveMode(opts: CLIOptions): Promise<void> {
  // If a WebUI port was explicitly requested alongside TUI, start the server
  // in the background — same process, same globalBus, so all pipeline events
  // are visible in the browser in real time.
  if (opts.webuiPort) {
    const { WebUIServer } = await import('./webui/server.js');
    const srv = new WebUIServer({
      port:      opts.webuiPort,
      host:      '0.0.0.0',
      targetDir: opts.targetDir,
      verbose:   opts.verbose,
      dryRun:    opts.dryRun,
    });
    await srv.start();
  }

  // Real terminal → full-screen TUI. Pipes / CI → line-based REPL fallback.
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const { TuiApp } = await import('./cli/tui/app.js');
    const app = new TuiApp({
      projectDir: opts.targetDir,
      model:      opts.model || undefined,
      verbose:    opts.verbose,
      dryRun:     opts.dryRun,
    });
    await app.start();
    return;
  }
  const repl = new SophosREPL({
    projectDir: opts.targetDir,
    model:      opts.model || undefined,
    verbose:    opts.verbose,
    dryRun:     opts.dryRun,
  });
  await repl.start();
}

async function runWebUIMode(opts: CLIOptions): Promise<void> {
  const { WebUIServer } = await import('./webui/server.js');
  const server = new WebUIServer({
    port:      opts.webuiPort,
    host:      '0.0.0.0',
    targetDir: opts.targetDir,
    verbose:   opts.verbose,
    dryRun:    opts.dryRun,
  });
  await server.start();

  // Optionally start tunnel
  if (opts.tunnel) {
    const { startTunnel } = await import('./tunnel/tunnel.js');
    try {
      await startTunnel({ port: opts.webuiPort, provider: opts.tunnelProvider as any });
    } catch (err: any) {
      console.error(`\n  ${c.error('Tunnel failed:')} ${err.message}\n`);
    }
  }
}

async function runMCPMode(opts: CLIOptions): Promise<void> {
  const { MCPServer } = await import('./mcp/server.js');
  const server = new MCPServer(opts.targetDir);
  server.start();
}

async function runBatchMode(opts: CLIOptions): Promise<void> {
  console.log(banner({ version: pkg.version }));
  console.log(statusBar({ connected: true, model: opts.model || 'auto' }));
  console.log(`\n  ${c.muted('Target:')}  ${c.accent(opts.targetDir)}`);
  console.log(`  ${c.muted('Request:')} ${c.text(opts.request)}`);
  console.log(`  ${c.muted('Plan:')}    ${opts.planMode ? c.warning('ON') : c.muted('OFF')}`);
  console.log('');

  const sophosConfig = loadConfig(opts.configPath || getDefaultConfigPath());
  const orchConfig: OrchestratorConfig = {
    target_dir:            opts.targetDir,
    user_request:          opts.request,
    max_review_iterations: opts.maxReviews,
    max_repair_attempts:   opts.maxRepairs,
    verbose:               opts.verbose,
    dry_run:               opts.dryRun || opts.planMode,
  };

  const abortCtrl = new AbortController();
  const onSigint = () => {
    console.log(`\n  ${c.warning('⚡')} Interrupting pipeline…`);
    abortCtrl.abort();
  };
  process.on('SIGINT', onSigint);

  const orchestrator = new Orchestrator(orchConfig, sophosConfig);

  // Pipe events to stdout in batch mode
  orchestrator.on('phase:start', e => console.log(`\n  ${c.warning('▶')} ${e.phaseName}`));
  orchestrator.on('phase:line',  e => console.log(`    ${c.muted(e.line)}`));
  orchestrator.on('phase:done',  e => console.log(`  ${c.success('✓')} ${e.phaseName}  ${c.dim(`${e.durationMs}ms`)}`));
  orchestrator.on('phase:fail',  e => console.log(`  ${c.error('✗')} ${e.phaseName}: ${e.error}`));

  let result;
  try {
    result = await orchestrator.execute(abortCtrl.signal);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log(`\n  ${c.warning('⚡')} Pipeline cancelled. Partial results may have been written.\n`);
      process.exit(130);
    }
    console.error(`\n  ${c.error('Fatal:')} ${err.message}\n`);
    process.exit(1);
  } finally {
    process.off('SIGINT', onSigint);
  }

  if (result.deliverables) {
    const d = result.deliverables;
    console.log('\n' + '═'.repeat(60));
    console.log(`  ${result.success ? c.success('✓ COMPLETE') : c.error('✗ FAILED')}`);
    console.log('═'.repeat(60));
    console.log(`  ${d.executive_summary}`);
    console.log(`  Created:  ${d.files_created.length}  Modified: ${d.files_modified.length}`);
    console.log(`  Security: ${d.security_report.length} findings`);
    if (d.llm_stats) {
      console.log(`  LLM:      ${d.llm_stats.calls} calls, ${d.llm_stats.total_tokens} tokens`);
    }
    console.log('');
  } else {
    console.log(`\n  ${c.error('Pipeline failed.')} Check output above.\n`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
