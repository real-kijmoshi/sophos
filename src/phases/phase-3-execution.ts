import { LLMAgent } from '../llm/agent.js';
import { PROMPTS } from '../llm/prompts.js';
import type { ImplementationSpecification, TaskPrompt, TaskGraph } from '../types.js';
import type { SophosConfig } from '../config/config.js';
import { readFileContent } from '../utils/file-scanner.js';

export async function executeExecutionPlanning(
  config: SophosConfig,
  spec: ImplementationSpecification,
  contextPkg: any,
  targetDir: string,
  llm?: LLMAgent,
): Promise<TaskGraph> {
  const agent = llm ?? new LLMAgent(config);

  const context = [
    `Repository: ${contextPkg?.repository_summary?.name || 'unknown'}`,
    `Type: ${contextPkg?.repository_summary?.type || 'unknown'}`,
    `Languages: ${contextPkg?.technology_stack?.languages?.join(', ') || 'unknown'}`,
    `Frameworks: ${contextPkg?.technology_stack?.frameworks?.join(', ') || 'none'}`,
    `Architecture: ${contextPkg?.architecture_overview?.pattern || 'unknown'}`,
  ].join('\n');

  console.log('  Generating detailed task prompts via LLM...');

  const prompt = PROMPTS.executionPlan(spec, context);
  const tasks = await agent.callJSON<TaskPrompt[]>('execution-planner', [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ], { model_tier: 'executor', timeout_ms: 180_000 });

  const taskList = Array.isArray(tasks) ? tasks : (tasks as any).tasks || [];

  for (const task of taskList) {
    if (!task.task_id) task.task_id = `TASK-${String(taskList.indexOf(task) + 1).padStart(3, '0')}`;
    if (!task.files) task.files = [];
    if (!task.constraints) task.constraints = [];
    if (!task.dependencies) task.dependencies = [];
    if (!task.acceptance_criteria) task.acceptance_criteria = [];
    if (!task.test_requirements) task.test_requirements = [];
  }

  console.log(`  Generated ${taskList.length} task prompts`);

  const parallelGroups = identifyParallelGroups(taskList);
  const criticalPath = findCriticalPath(taskList);

  console.log(`  Parallel groups: ${parallelGroups.length}`);
  console.log(`  Critical path: ${criticalPath.join(' → ')}`);

  return {
    tasks: taskList,
    parallel_groups: parallelGroups,
    critical_path: criticalPath,
  };
}

function identifyParallelGroups(tasks: TaskPrompt[]): string[][] {
  const groups: string[][] = [];
  const assigned = new Set<string>();

  while (assigned.size < tasks.length) {
    const group: string[] = [];
    for (const task of tasks) {
      if (assigned.has(task.task_id)) continue;
      const depsMet = task.dependencies.every(d => assigned.has(d));
      const noSharedFiles = group.every(gid => {
        const gt = tasks.find(t => t.task_id === gid);
        return !gt || !gt.files.some(f => task.files.includes(f));
      });
      if (depsMet && noSharedFiles) {
        group.push(task.task_id);
      }
    }
    if (group.length === 0) {
      const remaining = tasks.filter(t => !assigned.has(t.task_id));
      if (remaining.length > 0) group.push(remaining[0].task_id);
      else break;
    }
    groups.push(group);
    group.forEach(id => assigned.add(id));
  }

  return groups;
}

function findCriticalPath(tasks: TaskPrompt[]): string[] {
  const path: string[] = [];
  const completed = new Set<string>();

  while (completed.size < tasks.length) {
    let best: TaskPrompt | null = null;
    for (const task of tasks) {
      if (completed.has(task.task_id)) continue;
      if (task.dependencies.every(d => completed.has(d))) {
        if (!best || task.files.length > best.files.length) best = task;
      }
    }
    if (!best) break;
    path.push(best.task_id);
    completed.add(best.task_id);
  }

  return path;
}
