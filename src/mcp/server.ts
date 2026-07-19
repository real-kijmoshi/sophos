// ── MCP Server ─────────────────────────────────────────────────────────────────
// Model Context Protocol server over stdio (JSON-RPC 2.0).
// Exposes Sophos pipeline capabilities as MCP tools.

import * as path from 'node:path';
import { Orchestrator } from '../orchestrator.js';
import { loadConfig } from '../config/config.js';
import type { OrchestratorConfig } from '../types.js';
import type { SophosConfig } from '../config/config.js';

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id:      number | string;
  method:  string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id:      number | string | null;
  result?: unknown;
  error?:  { code: number; message: string; data?: unknown };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'sophos_pipeline',
    description: 'Run the full 9-phase Sophos pipeline on a target directory. Analyzes the codebase, plans implementation, generates code, reviews it through multiple AI agents, runs security scans, and produces deliverables.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target_dir:   { type: 'string', description: 'Target directory to operate on' },
        request:      { type: 'string', description: 'User request describing what to build or fix' },
        plan_only:    { type: 'boolean', description: 'If true, only plan without writing files', default: false },
        verbose:      { type: 'boolean', description: 'Enable verbose output', default: false },
      },
      required: ['target_dir', 'request'],
    },
  },
  {
    name: 'sophos_analyze',
    description: 'Analyze a codebase: detect tech stack, architecture, file structure, dependencies, and potential risks. Returns a structured context package.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target_dir: { type: 'string', description: 'Directory to analyze' },
        request:    { type: 'string', description: 'What to focus the analysis on', default: '' },
      },
      required: ['target_dir'],
    },
  },
  {
    name: 'sophos_status',
    description: 'Get the current status of Sophos: Ollama connection, available models, and configuration.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sophos_config',
    description: 'Get or update the Sophos configuration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action:  { type: 'string', enum: ['get', 'set'], description: 'Get or set config' },
        key:     { type: 'string', description: 'Config key (dot notation, e.g. "ollama.model_medium")' },
        value:   { type: 'string', description: 'Value to set (only for set action)' },
      },
      required: ['action'],
    },
  },
];

// ── Resource definitions ──────────────────────────────────────────────────────

const RESOURCES = [
  {
    uri:         'sophos://config',
    name:        'Sophos Configuration',
    description: 'Current Sophos configuration including Ollama settings and pipeline options',
    mimeType:    'application/json',
  },
  {
    uri:         'sophos://status',
    name:        'Sophos Status',
    description: 'Current status: Ollama connection, models, version',
    mimeType:    'application/json',
  },
];

// ── Server ────────────────────────────────────────────────────────────────────

export class MCPServer {
  private targetDir: string;
  private config: SophosConfig;

  constructor(targetDir: string) {
    this.targetDir = targetDir;
    this.config    = loadConfig();
  }

  start(): void {
    const stdin = process.stdin;
    stdin.setEncoding('utf-8');
    stdin.resume();

    let buffer = '';

    stdin.on('data', (chunk: string) => {
      buffer += chunk;
      // MCP uses newline-delimited JSON-RPC
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const request = JSON.parse(trimmed) as JSONRPCRequest;
          this.handleRequest(request).catch(err => {
            this.sendError(request.id ?? null, -32603, err.message);
          });
        } catch {
          // Ignore malformed JSON
        }
      }
    });

    process.stderr.write('Sophos MCP server started on stdio\n');
  }

  private async handleRequest(req: JSONRPCRequest): Promise<void> {
    switch (req.method) {
      case 'initialize':
        this.send(req.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools:    { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: {
            name:    'sophos',
            version: '3.0.0',
          },
        });
        break;

      case 'notifications/initialized':
        // Client acknowledgment, no response needed
        break;

      case 'tools/list':
        this.send(req.id, { tools: TOOLS });
        break;

      case 'tools/call':
        await this.handleToolCall(req);
        break;

      case 'resources/list':
        this.send(req.id, { resources: RESOURCES });
        break;

      case 'resources/read':
        await this.handleResourceRead(req);
        break;

      case 'ping':
        this.send(req.id, {});
        break;

      default:
        this.sendError(req.id ?? null, -32601, `Method not found: ${req.method}`);
    }
  }

  private async handleToolCall(req: JSONRPCRequest): Promise<void> {
    const { name, arguments: args } = req.params as { name: string; arguments: Record<string, unknown> };

    switch (name) {
      case 'sophos_pipeline': {
        const targetDir = (args.target_dir as string) || this.targetDir;
        const request   = args.request as string;
        const planOnly  = (args.plan_only as boolean) ?? false;
        const verbose   = (args.verbose as boolean) ?? false;

        const orchConfig: OrchestratorConfig = {
          target_dir:            path.resolve(targetDir),
          user_request:          request,
          max_review_iterations: this.config.pipeline.max_review_iterations,
          max_repair_attempts:   this.config.pipeline.max_repair_attempts,
          verbose,
          dry_run:               planOnly,
        };

        const orch = new Orchestrator(orchConfig, this.config);
        const result = await orch.execute();

        this.send(req.id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success:   result.success,
              summary:   result.deliverables?.executive_summary ?? 'Pipeline completed',
              files:     {
                created:  result.deliverables?.files_created?.length ?? 0,
                modified: result.deliverables?.files_modified?.length ?? 0,
              },
              security:  result.deliverables?.security_report?.length ?? 0,
              llm_stats: result.deliverables?.llm_stats ?? null,
            }, null, 2),
          }],
        });
        break;
      }

      case 'sophos_analyze': {
        const { executeRepositoryAnalysis } = await import('../phases/phase-1-repository.js');
        const targetDir = (args.target_dir as string) || this.targetDir;
        const request   = (args.request as string) ?? '';

        const context = await executeRepositoryAnalysis(
          this.config,
          path.resolve(targetDir),
          request,
        );

        this.send(req.id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              repository: context.repository_summary,
              stack:      context.technology_stack,
              arch:       context.architecture_overview,
              files:      context.relevant_files.length,
              risks:      context.potential_risks.length,
            }, null, 2),
          }],
        });
        break;
      }

      case 'sophos_status': {
        const ollamaUrl = this.config.ollama.base_url;
        let online = false;
        try {
          const resp = await fetch(`${ollamaUrl}/api/tags`);
          online = resp.ok;
        } catch { /* */ }

        this.send(req.id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ollama: { url: ollamaUrl, online },
              models: {
                small:    this.config.ollama.model_small,
                medium:   this.config.ollama.model_medium,
                large:    this.config.ollama.model_large,
                coder:    this.config.ollama.model_coder,
                planner:  this.config.ollama.model_planner,
                executor: this.config.ollama.model_executor,
                chat:     this.config.ollama.model_chat,
              },
              version: '3.0.0',
            }, null, 2),
          }],
        });
        break;
      }

      case 'sophos_config': {
        const action = args.action as string;
        if (action === 'get') {
          this.send(req.id, {
            content: [{ type: 'text', text: JSON.stringify(this.config, null, 2) }],
          });
        } else {
          this.send(req.id, {
            content: [{ type: 'text', text: 'Config update not yet supported via MCP' }],
          });
        }
        break;
      }

      default:
        this.sendError(req.id ?? null, -32602, `Unknown tool: ${name}`);
    }
  }

  private async handleResourceRead(req: JSONRPCRequest): Promise<void> {
    const { uri } = req.params as { uri: string };

    switch (uri) {
      case 'sophos://config':
        this.send(req.id, {
          contents: [{
            uri:      'sophos://config',
            mimeType: 'application/json',
            text:     JSON.stringify(this.config, null, 2),
          }],
        });
        break;

      case 'sophos://status': {
        let online = false;
        try {
          const resp = await fetch(`${this.config.ollama.base_url}/api/tags`);
          online = resp.ok;
        } catch { /* */ }
        this.send(req.id, {
          contents: [{
            uri:      'sophos://status',
            mimeType: 'application/json',
            text:     JSON.stringify({ ollama_online: online, version: '3.0.0' }, null, 2),
          }],
        });
        break;
      }

      default:
        this.sendError(req.id ?? null, -32602, `Unknown resource: ${uri}`);
    }
  }

  private send(id: number | string | null, result: unknown): void {
    const resp: JSONRPCResponse = { jsonrpc: '2.0', id, result };
    process.stdout.write(JSON.stringify(resp) + '\n');
  }

  private sendError(id: number | string | null, code: number, message: string): void {
    const resp: JSONRPCResponse = { jsonrpc: '2.0', id, error: { code, message } };
    process.stdout.write(JSON.stringify(resp) + '\n');
  }
}
