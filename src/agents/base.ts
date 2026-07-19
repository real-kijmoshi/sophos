import type { AgentConfig, AgentRole } from '../types.js';

export abstract class Agent {
  readonly config: AgentConfig;
  readonly id: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.id = `${config.role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  get role(): AgentRole {
    return this.config.role;
  }

  get name(): string {
    return this.config.name;
  }

  abstract execute(input: unknown): Promise<unknown>;

  protected log(message: string): void {
    console.log(`  [${this.config.name}] ${message}`);
  }

  protected error(message: string): void {
    console.error(`  [${this.config.name}] ERROR: ${message}`);
  }
}
