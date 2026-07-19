import { LLMAgent } from '../llm/agent.js';
import { PROMPTS } from '../llm/prompts.js';
import type { TaskPrompt, TaskGraph } from '../types.js';
import type { SophosConfig } from '../config/config.js';
import { readFileContent, writeFileContent } from '../utils/file-scanner.js';
import { generateUnifiedDiff } from '../utils/diff-generator.js';
import { TaskQueue, type TaskResult } from '../task-queue/task.js';

export interface CodingOutput {
  task_id: string;
  unified_diff: string;
  files_changed: string[];
  summary: string;
  assumptions: string[];
  suggested_follow_up: string[];
  generated_files: Map<string, string>;
}

export async function executeCodingSwarm(
  config: SophosConfig,
  taskGraph: TaskGraph,
  targetDir: string,
  llm?: LLMAgent,
): Promise<Map<string, CodingOutput>> {
  const queue = new TaskQueue();
  for (const task of taskGraph.tasks) {
    queue.add({ ...task, id: task.task_id });
  }

  const results = new Map<string, CodingOutput>();
  const parallelGroups = taskGraph.parallel_groups;

  for (const group of parallelGroups) {
    console.log(`  Executing parallel group: ${group.join(', ')}`);

    const batchSize = Math.min(config.ollama.concurrent_requests, group.length);
    for (let i = 0; i < group.length; i += batchSize) {
      const batch = group.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(taskId => executeCodingTask(config, taskId, queue, targetDir, llm))
      );
      for (const result of batchResults) {
        if (result) results.set(result.task_id, result);
      }
    }
  }

  return results;
}

async function executeCodingTask(
  config: SophosConfig,
  taskId: string,
  queue: TaskQueue,
  targetDir: string,
  llm?: LLMAgent,
): Promise<CodingOutput | null> {
  const task = queue.get(taskId);
  if (!task) return null;

  queue.markRunning(taskId);

  const agent = llm ?? new LLMAgent(config);

  try {
    const existingFiles = readExistingFiles(task.files, targetDir);

    console.log(`    [${taskId}] Generating code...`);
    const taskPrompt: TaskPrompt = {
      task_id: task.id,
      objective: task.objective,
      context: task.context,
      files: task.files,
      constraints: task.constraints,
      dependencies: task.dependencies,
      acceptance_criteria: task.acceptance_criteria,
      test_requirements: task.test_requirements,
      prompt_for_coding_agent: task.prompt_for_coding_agent,
    };
    const prompt = PROMPTS.codeGeneration(taskPrompt, existingFiles);

    const response = await agent.call('coding-agent', [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ], { model_tier: 'coder', timeout_ms: 300_000 });

    const generatedFiles = parseGeneratedFiles(response.content);
    const diffs: string[] = [];
    const filesChanged: string[] = [];
    const newContents = new Map<string, string>();

    for (const [filePath, content] of generatedFiles) {
      const fullPath = `${targetDir}/${filePath}`;
      const original = readFileContent(fullPath);

      writeFileContent(fullPath, content);
      newContents.set(filePath, content);

      const diff = generateUnifiedDiff(original, content, filePath, filePath);
      if (diff) {
        diffs.push(diff);
        filesChanged.push(filePath);
      }
    }

    const result: TaskResult = {
      task_id: taskId,
      unified_diff: diffs.join('\n'),
      files_changed: filesChanged,
      summary: `Generated ${generatedFiles.size} files`,
      assumptions: [],
      suggested_follow_up: [],
      success: true,
      errors: [],
    };

    queue.markCompleted(taskId, result);

    return {
      task_id: taskId,
      unified_diff: diffs.join('\n'),
      files_changed: filesChanged,
      summary: `Generated ${generatedFiles.size} files: ${Array.from(generatedFiles.keys()).join(', ')}`,
      assumptions: [],
      suggested_follow_up: [],
      generated_files: newContents,
    };
  } catch (err: any) {
    console.error(`    [${taskId}] Error: ${err.message}`);
    queue.markFailed(taskId, [err.message]);
    return null;
  }
}

function readExistingFiles(files: string[], targetDir: string): string {
  const parts: string[] = [];
  for (const filePath of files) {
    const content = readFileContent(`${targetDir}/${filePath}`);
    if (content) {
      parts.push(`=== ${filePath} ===\n${content}\n=== END ${filePath} ===`);
    }
  }
  return parts.join('\n\n') || '(no existing file contents available)';
}

function parseGeneratedFiles(content: string): Map<string, string> {
  const files = new Map<string, string>();

  const regex = /===FILE:\s*(.+?)===\n([\s\S]*?)===END FILE===/g;
  let match;

  while ((match = regex.exec(content))) {
    const filePath = match[1].trim();
    let fileContent = match[2].trim();

    fileContent = fileContent.replace(/^```\w*\n/gm, '').replace(/\n```$/gm, '');

    files.set(filePath, fileContent);
  }

  if (files.size === 0) {
    const singleFileRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
    while ((match = singleFileRegex.exec(content))) {
      const fileContent = match[1].trim();
      if (fileContent.length > 20) {
        files.set('generated-file.ts', fileContent);
        break;
      }
    }
  }

  return files;
}
