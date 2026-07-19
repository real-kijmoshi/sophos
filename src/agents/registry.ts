import { Agent } from './base.js';
import type { AgentConfig } from '../types.js';

export class AgentRegistry {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  unregister(id: string): void {
    this.agents.delete(id);
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getByRole(role: string): Agent[] {
    return Array.from(this.agents.values()).filter(a => a.config.role === role);
  }

  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  create(config: AgentConfig, factory: (cfg: AgentConfig) => Agent): Agent {
    const agent = factory(config);
    this.register(agent);
    return agent;
  }

  clear(): void {
    this.agents.clear();
  }

  get size(): number {
    return this.agents.size;
  }
}
