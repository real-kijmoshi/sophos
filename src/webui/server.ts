// ── WebUI Server ───────────────────────────────────────────────────────────────
// HTTP + WebSocket server for the browser-based Sophos interface.
// Serves a single-page app with real-time pipeline streaming.

import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { Orchestrator } from '../orchestrator.js';
import { loadConfig } from '../config/config.js';
import type { OrchestratorConfig } from '../types.js';
import type { SophosConfig } from '../config/config.js';
import { c } from '../cli/ui.js';
import { getFrontendHTML } from './frontend.js';
import { globalBus } from '../global-bus.js';

export interface WebUIServerOptions {
  port:       number;
  host:       string;
  targetDir:  string;
  verbose?:   boolean;
  dryRun?:    boolean;
}

interface PipelineJob {
  id:        string;
  request:   string;
  targetDir: string;
  planOnly:  boolean;
  status:    'queued' | 'running' | 'done' | 'failed';
  startedAt: number;
  events:    PipelineEvent[];
  result?:   any;
  orch?:     Orchestrator;
  abort?:    AbortController;
}

interface PipelineEvent {
  type:      string;
  timestamp: number;
  data:      any;
}

let jobCounter = 0;

export class WebUIServer {
  private config: SophosConfig;
  private jobs: Map<string, PipelineJob> = new Map();
  private wsClients: Set<any> = new Set();
  private opts: WebUIServerOptions;

  constructor(opts: WebUIServerOptions) {
    this.opts   = opts;
    this.config = loadConfig();
  }

  async start(): Promise<void> {
    const { port, host } = this.opts;

    const server = Bun.serve({
      port,
      hostname: host,
      fetch: (req, server) => {
        const url = new URL(req.url);

        // WebSocket upgrade
        if (url.pathname === '/ws') {
          const success = server.upgrade(req);
          return success ? undefined : new Response('WebSocket upgrade failed', { status: 500 });
        }

        // API routes
        if (url.pathname === '/api/status')  return this.handleStatus();
        if (url.pathname === '/api/run')     return this.handleRun(req);
        if (url.pathname === '/api/jobs')    return this.handleJobs();
        if (url.pathname.startsWith('/api/job/')) return this.handleJobDetail(url.pathname);

        // Serve frontend
        return new Response(getFrontendHTML(), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
      websocket: {
        open: (ws) => {
          this.wsClients.add(ws);
          ws.send(JSON.stringify({ type: 'connected', message: 'Sophos WebUI connected' }));
        },
        message: (ws, message) => {
          try {
            const msg = JSON.parse(String(message));
            this.handleWSMessage(ws, msg);
          } catch { /* ignore */ }
        },
        close: (ws) => {
          this.wsClients.delete(ws);
        },
      },
    });

    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`\n  ${c.success('✓')} ${c.accent.bold('Sophos WebUI')}  ${c.text(url)}`);
    console.log(`  ${c.dim('pipeline events stream via WebSocket at /ws')}`);
    console.log(`  ${c.dim('press Ctrl+C to stop')}\n`);

    // Subscribe to the global bus so TUI/batch pipelines are also visible in the WebUI
    this.subscribeToGlobalBus();
  }

  // ── Global bus bridge ────────────────────────────────────────────────────────
  // Forwards events from ANY orchestrator (TUI, batch, MCP) to WebSocket clients.
  // Jobs started externally are registered on-demand with source='tui'/'batch'/etc.

  private subscribeToGlobalBus(): void {
    globalBus.on('job:started', (data: { jobId: string; request: string; source: string }) => {
      // Only track if not already known (webui-spawned jobs are already in this.jobs)
      if (!this.jobs.has(data.jobId)) {
        const job: PipelineJob = {
          id:        data.jobId,
          request:   data.request,
          targetDir: this.opts.targetDir,
          planOnly:  false,
          status:    'running',
          startedAt: Date.now(),
          events:    [],
        };
        this.jobs.set(job.id, job);
        this.broadcast({ type: 'job:queued',  job: { id: job.id, request: job.request } });
        this.broadcast({ type: 'job:started', jobId: job.id, source: data.source });
      }
    });

    globalBus.on('pipeline:event', (data: { jobId: string; event: any }) => {
      const job = this.jobs.get(data.jobId);
      if (!job) return;
      job.events.push({ type: data.event.type, timestamp: data.event.timestamp, data: data.event });
      this.broadcast({ type: 'pipeline:event', jobId: data.jobId, event: data.event });
    });

    globalBus.on('llm:token', (data: { jobId: string; chunk: string; agentName: string }) => {
      // Only broadcast if this job is known (it should be by now)
      if (!this.jobs.has(data.jobId)) return;
      this.broadcast({ type: 'llm:token', jobId: data.jobId, chunk: data.chunk, agentName: data.agentName });
    });

    globalBus.on('job:done', (data: { jobId: string; success: boolean; summary?: string }) => {
      const job = this.jobs.get(data.jobId);
      if (!job) return;
      job.status = data.success ? 'done' : 'failed';
      this.broadcast({
        type:    data.success ? 'job:completed' : 'job:failed',
        jobId:   data.jobId,
        success: data.success,
        summary: data.summary,
        error:   data.success ? undefined : 'Pipeline failed',
      });
    });

    globalBus.on('steering:ack', (data: { jobId: string; note: string }) => {
      this.broadcast({ type: 'steering:ack', jobId: data.jobId, note: data.note });
    });
  }

  // ── API handlers ─────────────────────────────────────────────────────────────

  private handleStatus(): Response {
    return Response.json({
      version:  '3.0.0',
      ollama:   { url: this.config.ollama.base_url },
      models:   {
        small:    this.config.ollama.model_small,
        medium:   this.config.ollama.model_medium,
        large:    this.config.ollama.model_large,
        coder:    this.config.ollama.model_coder,
        planner:  this.config.ollama.model_planner,
        executor: this.config.ollama.model_executor,
        chat:     this.config.ollama.model_chat,
      },
      jobs: this.jobs.size,
    });
  }

  private async handleRun(req: Request): Promise<Response> {
    try {
      const body = await req.json() as {
        request?: string;
        target_dir?: string;
        plan_only?: boolean;
      };

      if (!body.request) {
        return Response.json({ error: 'request is required' }, { status: 400 });
      }

      const job: PipelineJob = {
        id:        `job-${++jobCounter}`,
        request:   body.request,
        targetDir: body.target_dir ? path.resolve(body.target_dir) : this.opts.targetDir,
        planOnly:  body.plan_only ?? false,
        status:    'queued',
        startedAt: Date.now(),
        events:    [],
      };

      this.jobs.set(job.id, job);
      this.broadcast({ type: 'job:queued', job: { id: job.id, request: job.request } });

      // Run pipeline async
      this.runPipeline(job).catch(err => {
        job.status = 'failed';
        job.events.push({ type: 'error', timestamp: Date.now(), data: { error: err.message } });
        this.broadcast({ type: 'job:failed', jobId: job.id, error: err.message });
      });

      return Response.json({ jobId: job.id, status: 'queued' });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  private handleJobs(): Response {
    const jobs = [...this.jobs.values()].map(j => ({
      id:        j.id,
      request:   j.request,
      status:    j.status,
      startedAt: j.startedAt,
      events:    j.events.length,
    }));
    return Response.json({ jobs });
  }

  private handleJobDetail(pathname: string): Response {
    const jobId = pathname.replace('/api/job/', '');
    const job = this.jobs.get(jobId);
    if (!job) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({
      id:        job.id,
      request:   job.request,
      status:    job.status,
      startedAt: job.startedAt,
      events:    job.events,
      result:    job.result,
    });
  }

  // ── Pipeline runner ──────────────────────────────────────────────────────────

  private async runPipeline(job: PipelineJob): Promise<void> {
    job.status    = 'running';
    job.startedAt = Date.now();
    this.broadcast({ type: 'job:started', jobId: job.id });

    const orchConfig: OrchestratorConfig = {
      target_dir:            job.targetDir,
      user_request:          job.request,
      max_review_iterations: this.config.pipeline.max_review_iterations,
      max_repair_attempts:   this.config.pipeline.max_repair_attempts,
      verbose:               this.opts.verbose || false,
      dry_run:               this.opts.dryRun  || job.planOnly,
    };

    const ac   = new AbortController();
    const orch = new Orchestrator(orchConfig, this.config, 'webui');
    // Re-key the job under the orchestrator's canonical jobId
    if (job.id !== orch.jobId) {
      this.jobs.delete(job.id);
      job.id = orch.jobId;
      this.jobs.set(job.id, job);
    }
    job.orch  = orch;
    job.abort = ac;

    // All events flow through globalBus → subscribeToGlobalBus() handles broadcasting.
    // We just need to run the pipeline and handle the final result.
    const result = await orch.execute(ac.signal);
    job.status = result.success ? 'done' : 'failed';
    job.result = result.deliverables;
  }

  // ── WebSocket broadcast ──────────────────────────────────────────────────────

  private broadcast(data: any): void {
    const msg = JSON.stringify(data);
    for (const ws of this.wsClients) {
      try { ws.send(msg); } catch { this.wsClients.delete(ws); }
    }
  }

  private handleWSMessage(ws: any, msg: any): void {
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'run':
        // Allow running pipelines via WebSocket too
        this.handleRun(new Request('http://localhost/api/run', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(msg),
        })).then(r => r.json()).then(data => ws.send(JSON.stringify(data)));
        break;
      case 'steering': {
        // Inject a steering note into a running pipeline
        const job = this.jobs.get(msg.jobId);
        if (job?.orch && job.status === 'running') {
          job.orch.addSteering(msg.note);
        }
        break;
      }
      case 'cancel': {
        // Abort a running pipeline via AbortController signal
        const job = this.jobs.get(msg.jobId);
        if (job && job.status === 'running') {
          job.abort?.abort();
          job.status = 'failed';
          this.broadcast({ type: 'job:failed', jobId: job.id, error: 'Cancelled by user' });
        }
        break;
      }
    }
  }
}
