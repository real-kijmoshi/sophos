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

  // Use streaming so the connection stays alive and we get heartbeat feedback.
  // callJSON forces stream:false, which buffers the entire response before
  // returning a single byte — with a large/offloaded model this hangs silently.
  let rawContent = '';
  let tokenCount = 0;
  let lastDot = Date.now();

  // Wire a temporary token callback to collect content + show heartbeat dots.
  // We save/restore the existing callback so we don't break UI streaming in TUI mode.
  const prevCallback = (agent as any).tokenCallback as ((chunk: string, name: string) => void) | null;
  (agent as any).tokenCallback = (chunk: string, _name: string) => {
    rawContent += chunk;
    tokenCount++;
    // Print a dot every ~3 seconds to show progress without spamming
    const now = Date.now();
    if (now - lastDot > 3000) {
      process.stdout.write('.');
      lastDot = now;
    }
    // Also forward to the real UI callback if one exists
    prevCallback?.(chunk, 'execution-planner');
  };

  try {
    await agent.call('execution-planner', [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ], { model_tier: 'executor', format: 'json', stream: true, timeout_ms: 300_000 });
  } finally {
    // Always restore previous callback
    (agent as any).tokenCallback = prevCallback;
    // End the dots line if we printed any
    if (tokenCount > 0) process.stdout.write('\n');
  }

  // Parse the accumulated JSON (reuse agent's private parseJSON logic via callJSON path)
  let tasks: TaskPrompt[];
  try {
    const parsed = parseJSON(rawContent);
    tasks = Array.isArray(parsed) ? parsed : (parsed as any).tasks || [];
  } catch {
    // If parsing fails on the full content, surface a clear error
    throw new Error(
      `Execution planner returned invalid JSON (${tokenCount} tokens received). ` +
      `Raw content start: ${rawContent.slice(0, 200)}`
    );
  }

  const taskList = tasks;

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

// ── JSON parsing helper (mirrors agent.ts parseJSON) ─────────────────────────
function parseJSON(content: string): any {
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
