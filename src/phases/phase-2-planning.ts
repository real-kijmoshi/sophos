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

  // Build compact summaries for the synthesizer.
  // summarizePlannerOutput produces a dense, structured text per planner — far
  // fewer tokens than raw JSON while preserving all decision-relevant signals.
  const summaries = results.map(r => summarizePlannerOutput(r.planner, r.output));
  const plannerSummariesStr = summaries.join('\n');

  // ── Pass 1: Deduplication ─────────────────────────────────────────────────
  // Collapse overlapping files / APIs / deps across the 8 planners into one
  // clean list.  This is a small, fast call — the output feeds pass 2.
  console.log('  [1/2] Deduplicating proposals...');
  const dedupStartMs = Date.now();
  const dedupPrompt = PROMPTS.consensusDedup(plannerSummariesStr, userRequest);
  const dedupResult = await agent.callJSON<any>('consensus-dedup', [
    { role: 'system', content: dedupPrompt.system },
    { role: 'user',   content: dedupPrompt.user },
  ], { model_tier: 'planner', timeout_ms: 120_000, temperature: 0.1 });
  console.log(`  [1/2] Dedup done (${((Date.now() - dedupStartMs) / 1000).toFixed(1)}s)`);

  // Render the dedup result as compact text for pass 2
  const dedupStr = JSON.stringify(dedupResult, null, 2);

  // Extract planner highlights: only architecture/security/performance/testing
  // sections — the rich contextual parts that dedup doesn't capture.
  const highlightsStr = results.map(r => extractHighlights(r.planner, r.output)).join('\n');

  // ── Pass 2: Full spec synthesis ───────────────────────────────────────────
  // Uses the deduplicated list (authoritative for files/APIs/deps/tasks) plus
  // planner highlights (for architecture, testing, security, performance).
  console.log('  [2/2] Synthesizing specification...');
  const specStartMs = Date.now();
  const mergePrompt = PROMPTS.consensusMerge(dedupStr, highlightsStr, userRequest);
  const merged = await agent.callJSON<any>('consensus-merge', [
    { role: 'system', content: mergePrompt.system },
    { role: 'user',   content: mergePrompt.user },
  ], { model_tier: 'planner', timeout_ms: 600_000, temperature: 0.1 });
  console.log(`  [2/2] Synthesis done (${((Date.now() - specStartMs) / 1000).toFixed(1)}s)`);

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

// ── Compact planner output summarizer ─────────────────────────────────────────
// Extracts key signals from each planner's JSON output to reduce the context
// size fed into the consensus-merge step. Avoids dumping raw JSON which can
// easily be 20-40k tokens across 8 planners.

function summarizePlannerOutput(name: string, output: any): string {
  if (!output || typeof output !== 'object') return `\n--- ${name} Planner ---\n(empty)`;

  const lines: string[] = [`\n--- ${name} Planner ---`];

  // Architecture
  const arch = output.architecture;
  if (arch) {
    if (arch.diagram) lines.push(`Architecture: ${arch.diagram.slice(0, 200)}`);
    if (arch.components?.length) {
      lines.push(`Components: ${arch.components.map((c: any) => c.name || c).join(', ')}`);
    }
    if (arch.interfaces?.length) {
      lines.push(`Interfaces: ${arch.interfaces.map((i: any) => i.name || i).join(', ')}`);
    }
  }

  // Files to create — just paths + purpose
  if (output.files_to_create?.length) {
    lines.push(`Create: ${output.files_to_create.map((f: any) => `${f.path} — ${(f.purpose || f.template || '').slice(0, 60)}`).join('\n  ')}`);
  }

  // Files to edit — just paths + change descriptions
  if (output.files_to_edit?.length) {
    lines.push(`Edit: ${output.files_to_edit.map((f: any) => `${f.path} — ${(f.reason || '').slice(0, 60)}`).join('\n  ')}`);
  }

  // APIs
  if (output.apis?.length) {
    lines.push(`APIs: ${output.apis.map((a: any) => `${a.method} ${a.path}`).join(', ')}`);
  }

  // Services
  if (output.services?.length) {
    lines.push(`Services: ${output.services.map((s: any) => `${s.name} [${(s.responsibilities || []).slice(0, 3).join(', ')}]`).join('\n  ')}`);
  }

  // Dependencies
  if (output.dependencies?.add?.length) {
    lines.push(`Deps+: ${output.dependencies.add.map((d: any) => `${d.name}@${d.version || '?'} — ${(d.reason || '').slice(0, 40)}`).join(', ')}`);
  }

  // Database
  if (output.database_schema?.tables?.length) {
    lines.push(`DB tables: ${output.database_schema.tables.map((t: any) => typeof t === 'string' ? t : t.name).join(', ')}`);
  }

  // Config
  if (output.configuration?.env_vars?.length) {
    lines.push(`Env vars: ${output.configuration.env_vars.map((e: any) => e.name).join(', ')}`);
  }

  // Security
  if (output.security_requirements?.length) {
    lines.push(`Security: ${output.security_requirements.map((s: any) => `${s.category}: ${(s.requirement || '').slice(0, 60)}`).join('\n  ')}`);
  }

  // Implementation order
  if (output.implementation_order?.length) {
    lines.push(`Impl order: ${output.implementation_order.map((t: any) => `${t.task_id}(${(t.description || '').slice(0, 40)})[${t.effort || '?'}]`).join(', ')}`);
  }

  // Testing
  if (output.testing_strategy) {
    const ts = output.testing_strategy;
    if (ts.unit?.length) lines.push(`Unit tests: ${ts.unit.slice(0, 5).join(', ')}`);
    if (ts.integration?.length) lines.push(`Integration: ${ts.integration.slice(0, 5).join(', ')}`);
  }

  return lines.join('\n');
}

// ── Per-planner highlight extractor ──────────────────────────────────────────
// Pulls out the contextual sections (architecture, security, performance,
// testing) that summarizePlannerOutput omits or truncates heavily.
// These feed the second synthesis pass to inform non-structural decisions.

function extractHighlights(name: string, output: any): string {
  if (!output || typeof output !== 'object') return '';
  const lines: string[] = [`\n--- ${name} Highlights ---`];

  const arch = output.architecture;
  if (arch?.diagram) lines.push(`Arch: ${arch.diagram.slice(0, 300)}`);

  if (output.security_requirements?.length) {
    output.security_requirements.slice(0, 4).forEach((s: any) => {
      lines.push(`Security [${s.category}]: ${(s.requirement || '').slice(0, 120)}`);
    });
  }

  if (output.performance_goals?.length) {
    output.performance_goals.slice(0, 3).forEach((g: any) => {
      lines.push(`Perf [${g.metric}]: ${g.target} — ${(g.measurement || '').slice(0, 80)}`);
    });
  }

  if (output.testing_strategy) {
    const ts = output.testing_strategy;
    if (ts.unit?.length)        lines.push(`Tests/unit: ${ts.unit.slice(0, 4).join(' | ')}`);
    if (ts.integration?.length) lines.push(`Tests/integration: ${ts.integration.slice(0, 3).join(' | ')}`);
    if (ts.e2e?.length)         lines.push(`Tests/e2e: ${ts.e2e.slice(0, 2).join(' | ')}`);
  }

  if (output.rollback_strategy?.triggers?.length) {
    lines.push(`Rollback triggers: ${output.rollback_strategy.triggers.join(', ')}`);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}
