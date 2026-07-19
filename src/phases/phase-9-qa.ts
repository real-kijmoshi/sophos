import { LLMAgent } from '../llm/agent.js';
import { PROMPTS } from '../llm/prompts.js';
import type { QAResult, QACheck, SecurityFinding } from '../types.js';
import type { SophosConfig } from '../config/config.js';
import type { CodingOutput } from './phase-4-coding.js';
import type { ValidationResult } from './phase-6-validation.js';
import { readFileContent } from '../utils/file-scanner.js';

export async function executeFinalQA(
  config: SophosConfig,
  targetDir: string,
  userRequest: string,
  outputs: Map<string, CodingOutput>,
  securityFindings: SecurityFinding[],
  validationResult: ValidationResult,
  llm?: LLMAgent,
): Promise<QAResult> {
  const agent = llm ?? new LLMAgent(config);

  const allOutputsStr = Array.from(outputs.entries())
    .map(([id, o]) => `\n--- ${id} ---\nFiles: ${o.files_changed.join(', ')}\nSummary: ${o.summary}\nDiff length: ${o.unified_diff.length} chars`)
    .join('\n');

  const securityStr = securityFindings.length > 0
    ? JSON.stringify(securityFindings.slice(0, 20), null, 2)
    : 'No security findings';

  const validationStr = JSON.stringify({
    build: validationResult.build.success,
    typecheck: validationResult.typecheck.success,
    lint: validationResult.lint.success,
    tests: validationResult.unit_tests.success,
  }, null, 2);

  console.log('  Running LLM-based final QA...');

  try {
    const prompt = PROMPTS.finalQA(userRequest, allOutputsStr, securityStr, validationStr);
    const result = await agent.callJSON<any>('final-qa', [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ], { model_tier: 'coder' });

    return {
      checks: (result.checks || []).map((c: any) => ({
        name: c.name || 'Unknown check',
        passed: c.passed ?? true,
        details: c.details || '',
      })),
      decision: result.decision || 'approved',
      issues: result.issues || [],
    };
  } catch (err: any) {
    console.warn(`  LLM QA failed: ${err.message}, running fallback checks`);
    return executeFallbackQA(targetDir, outputs, securityFindings, validationResult);
  }
}

function executeFallbackQA(
  targetDir: string,
  outputs: Map<string, CodingOutput>,
  securityFindings: SecurityFinding[],
  validationResult: ValidationResult
): QAResult {
  const checks: QACheck[] = [];

  checks.push({
    name: 'Build passes',
    passed: validationResult.build.success,
    details: validationResult.build.success ? 'OK' : 'Build failed',
  });

  checks.push({
    name: 'Type-check passes',
    passed: validationResult.typecheck.success,
    details: validationResult.typecheck.success ? 'OK' : 'Type errors found',
  });

  checks.push({
    name: 'Lint passes',
    passed: validationResult.lint.success,
    details: validationResult.lint.success ? 'OK' : 'Lint errors found',
  });

  checks.push({
    name: 'Tests pass',
    passed: validationResult.unit_tests.success,
    details: validationResult.unit_tests.success ? 'OK' : 'Test failures',
  });

  const criticalFindings = securityFindings.filter(f => f.severity === 'critical' || f.severity === 'high');
  checks.push({
    name: 'No critical security findings',
    passed: criticalFindings.length === 0,
    details: criticalFindings.length === 0 ? 'Clean' : `${criticalFindings.length} critical/high findings`,
  });

  let todoCount = 0;
  for (const [, output] of outputs) {
    for (const [filePath, content] of output.generated_files) {
      todoCount += (content.match(/TODO|FIXME|HACK/g) || []).length;
    }
  }
  checks.push({
    name: 'No unfinished TODO/FIXME',
    passed: todoCount === 0,
    details: todoCount === 0 ? 'Clean' : `${todoCount} markers found`,
  });

  const allPassed = checks.every(c => c.passed);

  return {
    checks,
    decision: allPassed ? 'approved' : 'rejected',
    issues: checks.filter(c => !c.passed).map(c => `${c.name}: ${c.details}`),
  };
}
