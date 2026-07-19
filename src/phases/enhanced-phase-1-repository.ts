// ── Enhanced Repository Analysis Phase ──────────────────────────────────────
// Frontier-grade phase implementation with clean, structured output
// Uses enhanced logging interface instead of console.log

import { LLMAgent } from '../llm/agent.js';
import { PROMPTS } from '../llm/prompts.js';
import type { ContextPackage, PotentialRisk } from '../types.js';
import { scanRepository } from '../utils/file-scanner.js';
import type { SophosConfig } from '../config/config.js';
import { PhaseContext, PhaseLogging } from './enhanced-phase-interface.js';

export async function executeEnhancedRepositoryAnalysis(
  config: SophosConfig,
  rootDir: string,
  userRequest: string,
  llm?: LLMAgent,
  context?: PhaseContext
): Promise<ContextPackage> {
  const log = context?.log || console.log;
  
  // Phase start
  PhaseLogging.section('Repository Analysis', log);
  PhaseLogging.system(`Scanning: ${rootDir}`, log);
  
  const scan = await scanRepository(rootDir);
  
  const fileTree = buildFileTree(scan.files);
  const agent = llm ?? new LLMAgent(config);

  PhaseLogging.llm('Calling LLM for repository analysis...', log);

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

  PhaseLogging.success(`LLM analysis complete (${agent.getTotalTokens()} tokens)`, log);
  
  // Display results in a clean, structured format
  PhaseLogging.divider(log, 30);
  
  PhaseLogging.kv('Type', contextPackage.repository_summary.type, log);
  PhaseLogging.kv('Stack', contextPackage.technology_stack.languages.join(', '), log);
  PhaseLogging.kv('Files', contextPackage.repository_summary.file_count, log);
  PhaseLogging.kv('Size', `${contextPackage.repository_summary.size_mb} MB`, log);
  PhaseLogging.kv('Risks', contextPackage.potential_risks.length, log);
  
  // Show top risks if any
  if (contextPackage.potential_risks.length > 0) {
    PhaseLogging.divider(log, 20);
    PhaseLogging.security('Potential Risks:', log);
    contextPackage.potential_risks.slice(0, 3).forEach((risk: PotentialRisk, i: number) => {
      log(`  ${i + 1}. ${risk.description}`, { indent: 1 });
    });
    if (contextPackage.potential_risks.length > 3) {
      log(`  ... and ${contextPackage.potential_risks.length - 3} more`, { indent: 1, type: 'info' });
    }
  }
  
  PhaseLogging.divider(log, 30);
  PhaseLogging.success('Analysis complete', log);

  return contextPackage;
}

// Backward compatibility wrapper
export async function executeRepositoryAnalysis(
  config: SophosConfig,
  rootDir: string,
  userRequest: string,
  llm?: LLMAgent,
): Promise<ContextPackage> {
  // Fallback to console.log for backward compatibility
  const consoleLogger: PhaseContext['log'] = (message, options) => {
    const indent = options?.indent || 0;
    const icon = options?.icon || '';
    const prefix = '  '.repeat(indent) + (icon ? `${icon} ` : '');
    console.log(`${prefix}${message}`);
  };
  
  const context: PhaseContext = {
    log: consoleLogger,
  };
  
  return executeEnhancedRepositoryAnalysis(config, rootDir, userRequest, llm, context);
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