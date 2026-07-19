import { LLMAgent } from '../llm/agent.js';
import { PROMPTS } from '../llm/prompts.js';
import type { ContextPackage, ImplementationSpecification, TaskDefinition } from '../types.js';
import type { SophosConfig } from '../config/config.js';
import { readFileContent } from '../utils/file-scanner.js';
import { detectHardware, formatGPU } from '../utils/hardware-detector.js';

interface PlannerResult {
  planner: string;
  output: any;
}

export async function executePlanningSwarm(
  config: SophosConfig,
  context: ContextPackage,
  userRequest: string,
  llm?: LLMAgent,
): Promise<ImplementationSpecification> {
  const agent = llm ?? new LLMAgent(config);

  const relevantFilesDesc = context.relevant_files
    .slice(0, 10)
    .map(f => `  ${f.path} — ${f.reason} (confidence: ${f.confidence})`)
    .join('\n');

  console.log('  Spawning 8 planning agents...');

  // Show hardware + concurrency plan
  const plan = (config as any)._concurrency_plan;
  if (plan) {
    const specs = detectHardware();
    console.log(`  GPU: ${formatGPU(specs.gpu)}`);
    for (const r of plan.reasons) console.log(`  ${r}`);
  } else {
    console.log(`  Concurrency: ${config.ollama.concurrent_requests}`);
  }

  const planners: [string, () => Promise<PlannerResult>][] = [
    ['Architecture', async () => ({
      planner: 'Architecture',
      output: await agent.callJSON('planner-architecture', [
        { role: 'system', content: PROMPTS.plannerArchitecture(context, userRequest, relevantFilesDesc).system },
        { role: 'user', content: PROMPTS.plannerArchitecture(context, userRequest, relevantFilesDesc).user },
      ], { model_tier: 'planner' }),
    })],
    ['Backend', async () => ({
      planner: 'Backend',
      output: await agent.callJSON('planner-backend', [
        { role: 'system', content: PROMPTS.plannerBackend(context, userRequest).system },
        { role: 'user', content: PROMPTS.plannerBackend(context, userRequest).user },
      ], { model_tier: 'planner' }),
    })],
    ['Frontend', async () => ({
      planner: 'Frontend',
      output: await agent.callJSON('planner-frontend', [
        { role: 'system', content: PROMPTS.plannerFrontend(context, userRequest).system },
        { role: 'user', content: PROMPTS.plannerFrontend(context, userRequest).user },
      ], { model_tier: 'planner' }),
    })],
    ['Database', async () => ({
      planner: 'Database',
      output: await agent.callJSON('planner-database', [
        { role: 'system', content: PROMPTS.plannerDatabase(context, userRequest).system },
        { role: 'user', content: PROMPTS.plannerDatabase(context, userRequest).user },
      ], { model_tier: 'planner' }),
    })],
    ['DevOps', async () => ({
      planner: 'DevOps',
      output: await agent.callJSON('planner-devops', [
        { role: 'system', content: PROMPTS.plannerDevOps(context, userRequest).system },
        { role: 'user', content: PROMPTS.plannerDevOps(context, userRequest).user },
      ], { model_tier: 'planner' }),
    })],
    ['Security', async () => ({
      planner: 'Security',
      output: await agent.callJSON('planner-security', [
        { role: 'system', content: PROMPTS.plannerSecurity(context, userRequest).system },
        { role: 'user', content: PROMPTS.plannerSecurity(context, userRequest).user },
      ], { model_tier: 'planner' }),
    })],
    ['Performance', async () => ({
      planner: 'Performance',
      output: await agent.callJSON('planner-performance', [
        { role: 'system', content: PROMPTS.plannerPerformance(context, userRequest).system },
        { role: 'user', content: PROMPTS.plannerPerformance(context, userRequest).user },
      ], { model_tier: 'planner' }),
    })],
    ['Infrastructure', async () => ({
      planner: 'Infrastructure',
      output: await agent.callJSON('planner-infrastructure', [
        { role: 'system', content: PROMPTS.plannerInfrastructure(context, userRequest).system },
        { role: 'user', content: PROMPTS.plannerInfrastructure(context, userRequest).user },
      ], { model_tier: 'planner' }),
    })],
  ];

  const batchSize = config.ollama.concurrent_requests;
  const results: PlannerResult[] = [];
  const batchStartMs = Date.now();

  for (let i = 0; i < planners.length; i += batchSize) {
    const batch = planners.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(planners.length / batchSize);
    console.log(`  Batch ${batchNum}/${totalBatches}: Running ${batch.map(([name]) => name).join(', ')}...`);

    const batchResults = await Promise.all(batch.map(async ([name, fn]) => {
      const agentStartMs = Date.now();
      const result = await fn();
      const elapsed = ((Date.now() - agentStartMs) / 1000).toFixed(1);
      console.log(`    ✓ ${name} completed (${elapsed}s)`);
      return result;
    }));

    results.push(...batchResults);
    const batchElapsed = ((Date.now() - batchStartMs) / 1000).toFixed(1);
    console.log(`  Batch ${batchNum} done (${batchElapsed}s elapsed total)`);
  }

  console.log('  Merging planner proposals via Synthesizer...');

  const plannerOutputsStr = results.map(r => `\n--- ${r.planner} Planner ---\n${JSON.stringify(r.output, null, 2)}`).join('\n');

  const merged = await agent.callJSON<any>('consensus-merge', [
    { role: 'system', content: PROMPTS.consensusMerge(plannerOutputsStr, userRequest).system },
    { role: 'user', content: PROMPTS.consensusMerge(plannerOutputsStr, userRequest).user },
  ], { model_tier: 'planner', timeout_ms: 180_000 });

  const spec: ImplementationSpecification = {
    architecture: merged.architecture || { diagram: '', components: [], interfaces: [] },
    folder_structure: merged.folder_structure || { add: [], modify: [], delete: [] },
    files_to_create: merged.files_to_create || [],
    files_to_edit: merged.files_to_edit || [],
    apis: merged.apis || [],
    services: merged.services || [],
    components: merged.components || [],
    database_schema: merged.database_schema || { tables: [], migrations: [], indexes: [] },
    dependencies: merged.dependencies || { add: [], remove: [], update: [] },
    configuration: merged.configuration || { env_vars: [], config_files: [] },
    testing_strategy: merged.testing_strategy || { unit: [], integration: [], e2e: [] },
    security_requirements: merged.security_requirements || [],
    performance_goals: merged.performance_goals || [],
    rollback_strategy: merged.rollback_strategy || { steps: [], triggers: [] },
    implementation_order: merged.implementation_order || [],
  };

  console.log(`  Specification generated: ${spec.files_to_create.length} files to create, ${spec.files_to_edit.length} to edit`);
  console.log(`  Implementation tasks: ${spec.implementation_order.length}`);
  return spec;
}
