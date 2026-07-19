export interface Task {
  id: string;
  objective: string;
  context: string;
  files: string[];
  constraints: string[];
  dependencies: string[];
  acceptance_criteria: string[];
  test_requirements: string[];
  prompt_for_coding_agent: string;
  status: TaskStatus;
  result?: TaskResult;
  attempts: number;
}

export type TaskStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'repairing';

export interface TaskResult {
  task_id: string;
  unified_diff: string;
  files_changed: string[];
  summary: string;
  assumptions: string[];
  suggested_follow_up: string[];
  success: boolean;
  errors: string[];
}

export class TaskQueue {
  private tasks = new Map<string, Task>();

  add(task: Omit<Task, 'status' | 'attempts'>): void {
    this.tasks.set(task.id, { ...task, status: 'pending', attempts: 0 });
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  getReady(): Task[] {
    return this.getAll().filter(t =>
      t.status === 'pending' && this.dependenciesMet(t)
    );
  }

  getRunning(): Task[] {
    return this.getAll().filter(t => t.status === 'running');
  }

  markReady(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'pending' && this.dependenciesMet(task)) {
      task.status = 'ready';
    }
  }

  markRunning(id: string): void {
    const task = this.tasks.get(id);
    if (task && (task.status === 'pending' || task.status === 'ready')) {
      task.status = 'running';
    }
  }

  markCompleted(id: string, result: TaskResult): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'completed';
      task.result = result;
    }
  }

  markFailed(id: string, errors: string[]): void {
    const task = this.tasks.get(id);
    if (task) {
      task.attempts++;
      if (task.attempts >= 2) {
        task.status = 'failed';
      } else {
        task.status = 'repairing';
      }
      task.result = {
        task_id: id,
        unified_diff: '',
        files_changed: [],
        summary: '',
        assumptions: [],
        suggested_follow_up: [],
        success: false,
        errors,
      };
    }
  }

  markRepair(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'pending';
    }
  }

  private dependenciesMet(task: Task): boolean {
    return task.dependencies.every(depId => {
      const dep = this.tasks.get(depId);
      return dep?.status === 'completed';
    });
  }

  getParallelGroups(): string[][] {
    const groups: string[][] = [];
    const assigned = new Set<string>();
    const all = this.getAll();

    while (assigned.size < all.length) {
      const group: string[] = [];
      for (const task of all) {
        if (assigned.has(task.id)) continue;
        const depsMet = task.dependencies.every(d => assigned.has(d));
        if (depsMet) {
          group.push(task.id);
        }
      }
      if (group.length === 0) break;
      groups.push(group);
      group.forEach(id => assigned.add(id));
    }

    return groups;
  }

  getCriticalPath(): string[] {
    const path: string[] = [];
    const all = this.getAll();
    const completed = new Set<string>();

    while (completed.size < all.length) {
      let longest: Task | null = null;
      for (const task of all) {
        if (completed.has(task.id)) continue;
        if (task.dependencies.every(d => completed.has(d))) {
          if (!longest || task.files.length > longest.files.length) {
            longest = task;
          }
        }
      }
      if (!longest) break;
      path.push(longest.id);
      completed.add(longest.id);
    }

    return path;
  }

  get allCompleted(): boolean {
    return this.getAll().every(t => t.status === 'completed');
  }

  get hasFailures(): boolean {
    return this.getAll().some(t => t.status === 'failed');
  }
}
