// ── Global Event Bus ───────────────────────────────────────────────────────────
// Process-wide singleton EventEmitter.  Every Orchestrator instance publishes
// its events here so any subscriber (WebUI server, MCP, tests …) can observe
// ALL pipelines regardless of how they were launched (TUI, batch, webui, MCP).
//
// Usage:
//   import { globalBus } from '../global-bus.js';
//   globalBus.emit('pipeline:event', payload);
//   globalBus.on('pipeline:event', handler);

import { EventEmitter } from 'node:events';

// ── Event catalogue ───────────────────────────────────────────────────────────
export interface BusJobStarted {
  jobId:    string;
  request:  string;
  source:   'tui' | 'webui' | 'batch' | 'mcp';
}

export interface BusPipelineEvent {
  jobId: string;
  event: {
    type:      string;
    timestamp: number;
    [key: string]: any;
  };
}

export interface BusLlmToken {
  jobId:     string;
  chunk:     string;
  agentName: string;
}

export interface BusJobDone {
  jobId:   string;
  success: boolean;
  summary?: string;
}

export interface BusSteeringAck {
  jobId: string;
  note:  string;
}

// ── Singleton ─────────────────────────────────────────────────────────────────
class GlobalBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(64);  // many WS clients may listen simultaneously
  }
}

// Use a symbol on globalThis so the same instance survives hot-reloads in
// development (Bun doesn't deduplicate module caches across dynamic imports).
const KEY = Symbol.for('sophos.globalBus');
if (!(globalThis as any)[KEY]) {
  (globalThis as any)[KEY] = new GlobalBus();
}

export const globalBus: GlobalBus = (globalThis as any)[KEY];
