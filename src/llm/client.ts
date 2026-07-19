// ── Ollama Client v3.2 ────────────────────────────────────────────────────────
import type { SophosConfig } from '../config/config.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content:          string;
  model:            string;
  total_duration_ms:number;
  eval_count:       number;
  prompt_eval_count:number;
}

export interface GenerateOptions {
  model?:       string;
  temperature?: number;
  top_p?:       number;
  num_ctx?:     number;
  timeout_ms?:  number;
  format?:      'json' | 'text';
  signal?:      AbortSignal;
}

export class OllamaClient {
  private config:  SophosConfig;
  private baseUrl: string;

  constructor(config: SophosConfig) {
    this.config  = config;
    this.baseUrl = config.ollama.base_url;
  }

  // ── Non-streaming generate ────────────────────────────────────────────────────
  async generate(messages: LLMMessage[], opts: GenerateOptions = {}): Promise<LLMResponse> {
    const model   = opts.model       || this.config.ollama.model_medium;
    const timeout = opts.timeout_ms  ?? this.config.ollama.timeout_ms;

    const body: any = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: opts.temperature ?? this.config.ollama.temperature,
        top_p:       opts.top_p       ?? this.config.ollama.top_p,
        num_ctx:     opts.num_ctx     ?? this.config.ollama.num_ctx,
      },
    };
    if (opts.format === 'json') body.format = 'json';

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < this.config.ollama.max_retries; attempt++) {
      try {
        const ctrl    = new AbortController();
        const timer   = setTimeout(() => ctrl.abort(), timeout);
        // Honour caller abort as well
        opts.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });

        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`);
        const data = await res.json() as any;

        return {
          content:           data.message?.content        || '',
          model:             data.model                   || model,
          total_duration_ms: data.total_duration
            ? Math.round(data.total_duration / 1_000_000) : 0,
          eval_count:        data.eval_count              || 0,
          prompt_eval_count: data.prompt_eval_count       || 0,
        };
      } catch (err: any) {
        lastErr = err;
        if (opts.signal?.aborted || err.name === 'AbortError') throw err;
        if (attempt < this.config.ollama.max_retries - 1) await sleep(1000 * (attempt + 1));
      }
    }
    throw new Error(`Ollama failed after ${this.config.ollama.max_retries} attempts: ${lastErr?.message}`);
  }

  // ── Streaming generate ────────────────────────────────────────────────────────
  async generateStream(
    messages:  LLMMessage[],
    onChunk:   (chunk: string) => void,
    opts:      GenerateOptions = {},
  ): Promise<LLMResponse> {
    const model   = opts.model      || this.config.ollama.model_medium;
    const timeout = opts.timeout_ms ?? this.config.ollama.timeout_ms;

    const body: any = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      options: {
        temperature: opts.temperature ?? this.config.ollama.temperature,
        top_p:       opts.top_p       ?? this.config.ollama.top_p,
        num_ctx:     opts.num_ctx     ?? this.config.ollama.num_ctx,
      },
    };
    if (opts.format === 'json') body.format = 'json';

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    opts.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
    // Do NOT clear the timer here — it must cover the full streaming duration,
    // not just the connection setup. It will be cleared after the stream ends.

    if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`);

    const reader  = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec          = new TextDecoder();
    let fullContent    = '';
    let evalCount      = 0;
    let promptEvalCount = 0;
    let totalDurationMs = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (opts.signal?.aborted) { reader.cancel(); break; }

        const text = dec.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            if (chunk.message?.content) {
              fullContent += chunk.message.content;
              onChunk(chunk.message.content);
            }
            if (chunk.eval_count)         evalCount        = chunk.eval_count;
            if (chunk.prompt_eval_count)  promptEvalCount  = chunk.prompt_eval_count;
            if (chunk.total_duration)     totalDurationMs  = Math.round(chunk.total_duration / 1_000_000);
          } catch { /* partial line */ }
        }
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }

    return {
      content:           fullContent,
      model,
      total_duration_ms: totalDurationMs,
      eval_count:        evalCount,
      prompt_eval_count: promptEvalCount,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch { return false; }
  }

  async listModels(): Promise<string[]> {
    try {
      const r    = await fetch(`${this.baseUrl}/api/tags`);
      if (!r.ok) return [];
      const data = await r.json() as any;
      return (data.models ?? []).map((m: any) => m.name as string);
    } catch { return []; }
  }

  async pullModel(model: string, onProgress?: (status: string) => void): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
    });
    if (!res.ok) throw new Error(`Pull failed: ${res.statusText}`);
    const reader = res.body?.getReader();
    if (!reader) return;
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of dec.decode(value, { stream: true }).split('\n')) {
        try { const c = JSON.parse(line); if (c.status && onProgress) onProgress(c.status); } catch { /* */ }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
