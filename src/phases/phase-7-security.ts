import { LLMAgent } from '../llm/agent.js';
import { PROMPTS } from '../llm/prompts.js';
import type { SecurityFinding } from '../types.js';
import type { SophosConfig } from '../config/config.js';

const SECURITY_AGENTS = [
  { name: 'AuthZ',         domain: 'Authentication & Authorization',              cwe: ['CWE-287', 'CWE-306', 'CWE-862'] },
  { name: 'Injection',     domain: 'SQL, NoSQL, XSS, SSRF, Command Injection',    cwe: ['CWE-89',  'CWE-78',  'CWE-79', 'CWE-918'] },
  { name: 'Secrets',       domain: 'Secrets & Cryptography',                      cwe: ['CWE-798', 'CWE-311', 'CWE-327', 'CWE-330'] },
  { name: 'SupplyChain',   domain: 'Dependency Risks',                            cwe: ['CWE-1104'] },
  { name: 'BusinessLogic', domain: 'Logic Flaws',                                 cwe: ['CWE-840'] },
  { name: 'Privilege',     domain: 'Privilege Escalation',                        cwe: ['CWE-269', 'CWE-639'] },
];

export async function executeSecuritySwarm(
  config: SophosConfig,
  files: Map<string, string>,
  llm?: LLMAgent,
): Promise<SecurityFinding[]> {
  if (files.size === 0) return [];

  const agent = llm ?? new LLMAgent(config);

  const codeBlock = Array.from(files.entries())
    .map(([filePath, content]) => `=== ${filePath} ===\n${content}\n=== END ${filePath} ===`)
    .join('\n\n');

  const allFindings: SecurityFinding[] = [];

  const batchSize = config.ollama.concurrent_requests;
  for (let i = 0; i < SECURITY_AGENTS.length; i += batchSize) {
    const batch = SECURITY_AGENTS.slice(i, i + batchSize);
    console.log(`  Running security agents ${i + 1}-${Math.min(i + batchSize, SECURITY_AGENTS.length)}...`);

    const batchResults = await Promise.all(
      batch.map(async (def) => {
        try {
          const prompt  = PROMPTS.securityScan(def.domain, def.cwe, codeBlock);
          const result  = await agent.callJSON<any>(`security-${def.name.toLowerCase()}`, [
            { role: 'system', content: prompt.system },
            { role: 'user',   content: prompt.user },
          ], { model_tier: 'coder' });

          return (result.findings || []).map((f: any) => ({
            agent:         def.name,
            domain:        def.domain,
            severity:      f.severity      || 'low',
            confidence:    f.confidence    || 'low',
            cwe:           f.cwe           || '',
            description:   f.description   || '',
            affected_files:f.affected_files|| [],
            line_numbers:  f.line_numbers  || [],
            remediation:   f.remediation   || '',
          }));
        } catch (err: any) {
          console.warn(`    ${def.name} security agent failed: ${err.message}`);
          return [];
        }
      })
    );

    for (const findings of batchResults) {
      allFindings.push(...findings);
    }
  }

  if (allFindings.length > 0) {
    console.log('  Merging security findings via Synthesizer...');
    try {
      const findingsStr = JSON.stringify(allFindings, null, 2);
      const prompt      = PROMPTS.securityConsensus(findingsStr);
      const merged      = await agent.callJSON<any>('security-consensus', [
        { role: 'system', content: prompt.system },
        { role: 'user',   content: prompt.user },
      ], { model_tier: 'planner' });

      if (merged.findings && Array.isArray(merged.findings)) {
        return merged.findings.map((f: any) => ({
          agent:         f.agent         || 'Merged',
          domain:        f.domain        || '',
          severity:      f.severity      || 'low',
          confidence:    f.confidence    || 'low',
          cwe:           f.cwe           || '',
          description:   f.description   || '',
          affected_files:f.affected_files|| [],
          line_numbers:  f.line_numbers  || [],
          remediation:   f.remediation   || '',
        }));
      }
    } catch (err: any) {
      console.warn(`    Security consensus failed: ${err.message}`);
    }
  }

  return allFindings;
}

export function filterActionableFindings(findings: SecurityFinding[]): SecurityFinding[] {
  return findings.filter(f => {
    if (f.severity === 'critical' || f.severity === 'high')              return true;
    if (f.severity === 'medium'   && f.confidence === 'high')            return true;
    return false;
  });
}
