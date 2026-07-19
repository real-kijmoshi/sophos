import { LLMAgent } from '../llm/agent.js';
import { PROMPTS } from '../llm/prompts.js';
import type { ContextPackage, PotentialRisk } from '../types.js';
import { scanRepository } from '../utils/file-scanner.js';
import type { SophosConfig } from '../config/config.js';

export async function executeRepositoryAnalysis(
  config: SophosConfig,
  rootDir: string,
  userRequest: string,
  llm?: LLMAgent,
): Promise<ContextPackage> {
  const scan = await scanRepository(rootDir);

  const fileTree = buildFileTree(scan.files);
  const agent = llm ?? new LLMAgent(config);

  console.log('  Calling LLM for repository analysis...');

  const prompt = PROMPTS.repositoryAnalysis(fileTree, userRequest);
  const result = await agent.callJSON<any>('repository-analyzer', [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ], { model_tier: 'small', timeout_ms: 120_000 });

  const contextPackage: ContextPackage = {
    repository_summary: {
      name: result.repository_summary?.name || scan.files[0]?.relative_path.split('/')[0] || 'unknown',
      type: result.repository_summary?.type || 'unknown',
      size_mb: Math.round((scan.total_size / (1024 * 1024)) * 100) / 100,
      file_count: scan.files.length,
      language_breakdown: result.repository_summary?.language_breakdown || {},
    },
    technology_stack: {
      languages: result.technology_stack?.languages || [],
      frameworks: result.technology_stack?.frameworks || [],
      build_tools: result.technology_stack?.build_tools || [],
      package_managers: result.technology_stack?.package_managers || [],
      runtime: result.technology_stack?.runtime || [],
    },
    architecture_overview: {
      pattern: result.architecture_overview?.pattern || 'Monolith',
      layers: result.architecture_overview?.layers || [],
      entry_points: result.architecture_overview?.entry_points || [],
    },
    dependency_graph: { nodes: [], edges: [] },
    relevant_files: result.relevant_files || [],
    potential_risks: result.potential_risks || [],
    context_package_version: '1.0',
  };

  console.log(`  LLM analysis complete (${agent.getTotalTokens()} tokens)`);
  console.log(`  Type: ${contextPackage.repository_summary.type}`);
  console.log(`  Stack: ${contextPackage.technology_stack.languages.join(', ')}`);

  return contextPackage;
}

function buildFileTree(files: any[]): string {
  const tree: string[] = [];
  const sorted = files.map(f => f.relative_path).sort();

  let lastDir = '';
  for (const filePath of sorted) {
    const dir = filePath.split('/').slice(0, -1).join('/');
    if (dir !== lastDir) {
      tree.push(`\n${dir}/`);
      lastDir = dir;
    }
    tree.push(`  ${filePath.split('/').pop()}`);
  }

  return tree.join('\n').substring(0, 8000);
}
