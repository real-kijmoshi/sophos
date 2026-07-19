// ── LLM Agent v3.2 — with streaming support ───────────────────────────────────
import { OllamaClient, type LLMMessage, type LLMResponse } from './client.js';
import type { SophosConfig } from '../config/config.js';

export interface AgentCall {
  agent:       string;
  model:       string;
  duration_ms: number;
  tokens:      number;
  tps:         number;    // tokens per second
  success:     boolean;
  error?:      string;
}

export type TokenCallback = (chunk: string, agentName: string) => void;

export class LLMAgent {
  private client:   OllamaClient;
  private config:   SophosConfig;
  private callLog:  AgentCall[] = [];

  // Runtime model overrides
  private overrideSmall?:    string;
  private overrideMedium?:   string;
  private overrideLarge?:    string;
  private overrideCoder?:    string;
  private overridePlanner?:  string;
  private overrideExecutor?: string;
  private overrideChat?:     string;

  // Global token callback — wired by Orchestrator → PhaseRenderer
  private tokenCallback: TokenCallback | null = null;

  constructor(config: SophosConfig) {
    this.config = config;
    this.client = new OllamaClient(config);
  }

  // ── Streaming hook ────────────────────────────────────────────────────────────
  /** Wire a callback that receives every token chunk as it streams. */
  onToken(cb: TokenCallback): void {
    this.tokenCallback = cb;
  }

  // ── Model resolution ──────────────────────────────────────────────────────────
  setModels(opts: { small?: string; medium?: string; large?: string; coder?: string; planner?: string; executor?: string; chat?: string }): void {
    if (opts.small)    this.overrideSmall    = opts.small;
    if (opts.medium)   this.overrideMedium   = opts.medium;
    if (opts.large)    this.overrideLarge    = opts.large;
    if (opts.coder)    this.overrideCoder    = opts.coder;
    if (opts.planner)  this.overridePlanner  = opts.planner;
    if (opts.executor) this.overrideExecutor = opts.executor;
    if (opts.chat)     this.overrideChat     = opts.chat;
  }

  getModelForTier(tier: 'small' | 'medium' | 'large' | 'coder' | 'planner' | 'executor' | 'chat'): string {
    switch (tier) {
      case 'small':    return this.overrideSmall    || this.config.ollama.model_small    || '';
      case 'medium':   return this.overrideMedium   || this.config.ollama.model_medium   || '';
      case 'large':    return this.overrideLarge    || this.config.ollama.model_large    || '';
      case 'coder':    return this.overrideCoder    || this.config.ollama.model_coder    || this.config.ollama.model_medium || '';
      case 'planner':  return this.overridePlanner  || this.config.ollama.model_planner  || this.config.ollama.model_large  || '';
      case 'executor': return this.overrideExecutor || this.config.ollama.model_executor || this.config.ollama.model_large  || '';
      case 'chat':     return this.overrideChat     || this.config.ollama.model_chat     || this.config.ollama.model_medium || '';
    }
  }

  get client_(): OllamaClient { return this.client; }

  // ── call() — streams tokens when callback is wired ───────────────────────────
  async call(
    agentName: string,
    messages:  LLMMessage[],
    options: {
      model_tier?: 'small' | 'medium' | 'large' | 'coder' | 'planner' | 'executor' | 'chat';
      model?:      string;
      format?:     'json' | 'text';
      temperature?:number;
      timeout_ms?: number;
      stream?:     boolean;   // default true when tokenCallback is set
    } = {}
  ): Promise<LLMResponse> {
    const model    = options.model || this.getModelForTier(options.model_tier || 'medium');
    const startMs  = Date.now();
    // JSON calls stream too — the raw JSON tokens ARE the live output the UI shows.
    const useStream = (options.stream !== false) && !!this.tokenCallback;

    let response: LLMResponse;

    if (useStream) {
      // ── Streaming path ──────────────────────────────────────────────────────
      response = await this.client.generateStream(
        messages,
        (chunk: string) => {
          this.tokenCallback?.(chunk, agentName);
        },
        { model, temperature: options.temperature, timeout_ms: options.timeout_ms, format: options.format },
      );
    } else {
      // ── Non-streaming path (JSON calls always go here) ──────────────────────
      response = await this.client.generate(messages, {
        model,
        format:      options.format,
        temperature: options.temperature,
        timeout_ms:  options.timeout_ms,
      });
    }

    const elapsed = Date.now() - startMs;
    const tps     = elapsed > 0 ? Math.round((response.eval_count / elapsed) * 1000) : 0;

    this.callLog.push({
      agent:       agentName,
      model:       response.model,
      duration_ms: elapsed,
      tokens:      response.eval_count,
      tps,
      success:     true,
    });

    return response;
  }

  // ── callJSON() — always non-streaming, retries on bad JSON ───────────────────
  async callJSON<T = any>(
    agentName: string,
    messages:  LLMMessage[],
    options: {
      model_tier?:  'small' | 'medium' | 'large' | 'coder' | 'planner' | 'executor' | 'chat';
      model?:       string;
      temperature?: number;
      timeout_ms?:  number;
      maxRetries?:  number;
    } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp   = await this.call(agentName, messages, { ...options, format: 'json' });
        return this.parseJSON(resp.content) as T;
      } catch (err: any) {
        lastError = err;
      }
    }

    this.callLog.push({
      agent:       agentName,
      model:       this.getModelForTier(options.model_tier || 'medium'),
      duration_ms: 0, tokens: 0, tps: 0,
      success:     false,
      error:       lastError?.message,
    });

    throw new Error(`LLM call failed for ${agentName}: ${lastError?.message}`);
  }

  // ── JSON parser ───────────────────────────────────────────────────────────────
  private parseJSON(content: string): any {
    let s = content.trim();
    const m = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (m) s = m[1].trim();
    s = s.replace(/^JSON:\s*/i, '');
    try { return JSON.parse(s); } catch { /* */ }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a !== -1 && b > a) try { return JSON.parse(s.slice(a, b + 1)); } catch { /* */ }
    const c = s.indexOf('['), d = s.lastIndexOf(']');
    if (c !== -1 && d > c) try { return JSON.parse(s.slice(c, d + 1)); } catch { /* */ }
    throw new Error('Could not parse JSON from LLM response');
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────
  getCallLog():        AgentCall[] { return [...this.callLog]; }
  getTotalTokens():    number { return this.callLog.reduce((s, c) => s + c.tokens, 0); }
  getTotalDurationMs():number { return this.callLog.reduce((s, c) => s + c.duration_ms, 0); }
  getAvgTps():         number {
    const calls = this.callLog.filter(c => c.tps > 0);
    return calls.length ? Math.round(calls.reduce((s, c) => s + c.tps, 0) / calls.length) : 0;
  }

  async isAvailable():   Promise<boolean>  { return this.client.isAvailable(); }
  async listModels():    Promise<string[]> { return this.client.listModels(); }
}
