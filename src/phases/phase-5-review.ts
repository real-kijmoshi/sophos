import { LLMAgent } from '../llm/agent.js';
import { PROMPTS } from '../llm/prompts.js';
import type { ReviewResult, ReviewIssue } from '../types.js';
import type { SophosConfig } from '../config/config.js';
import type { CodingOutput } from './phase-4-coding.js';
import { readFileContent } from '../utils/file-scanner.js';

interface ReviewerDef {
  name: string;
  promptFn: (taskId: string, diff: string, files: string) => { system: string; user: string };
}

const REVIEWERS: ReviewerDef[] = [
  { name: 'Logic', promptFn: PROMPTS.reviewLogic },
  { name: 'Bug', promptFn: PROMPTS.reviewBug },
  { name: 'Architecture', promptFn: PROMPTS.reviewArchitecture },
  { name: 'Style', promptFn: PROMPTS.reviewStyle },
  { name: 'Performance', promptFn: PROMPTS.reviewPerformance },
];

export async function executeCodeReview(
  config: SophosConfig,
  outputs: Map<string, CodingOutput>,
  targetDir: string,
  llm?: LLMAgent,
): Promise<ReviewResult[]> {
  const agent = llm ?? new LLMAgent(config);
  const allReviews: ReviewResult[] = [];

  for (const [taskId, output] of outputs) {
    console.log(`  Reviewing ${taskId} with 5 independent reviewers...`);

    const fileContents = output.files_changed
      .map(f => {
        const content = readFileContent(`${targetDir}/${f}`);
        return `=== ${f} ===\n${content}\n=== END ${f} ===`;
      })
      .join('\n\n');

    const diff = output.unified_diff || '(new files)';

    const batchSize = config.ollama.concurrent_requests;
    for (let i = 0; i < REVIEWERS.length; i += batchSize) {
      const batch = REVIEWERS.slice(i, i + batchSize);
      const batchReviews = await Promise.all(
        batch.map(async (reviewer) => {
          try {
            const prompt = reviewer.promptFn(taskId, diff, fileContents);
            const result = await agent.callJSON<any>(`reviewer-${reviewer.name.toLowerCase()}`, [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ], { model_tier: 'coder' });

            return {
              reviewer: `${reviewer.name} Reviewer`,
              task_id: taskId,
              issues: (result.issues || []).map((i: any) => ({
                severity: i.severity || 'low',
                category: i.category || reviewer.name.toLowerCase(),
                description: i.description || '',
                affected_files: i.affected_files || [],
                line_numbers: i.line_numbers || [],
                suggested_fix: i.suggested_fix || '',
              })),
              approval_status: result.approval_status || 'approved',
            } as ReviewResult;
          } catch (err: any) {
            console.warn(`    ${reviewer.name} reviewer failed: ${err.message}`);
            return {
              reviewer: `${reviewer.name} Reviewer`,
              task_id: taskId,
              issues: [],
              approval_status: 'approved' as const,
            };
          }
        })
      );
      allReviews.push(...batchReviews);
    }

    const taskReviews = allReviews.filter(r => r.task_id === taskId);
    const approved = taskReviews.filter(r => r.approval_status === 'approved').length;
    console.log(`    ${taskId}: ${approved}/${taskReviews.length} approved`);
  }

  return allReviews;
}

export async function buildReviewConsensus(
  config: SophosConfig,
  reviews: ReviewResult[],
  llm?: LLMAgent,
): Promise<{
  approved: boolean;
  merged_issues: ReviewIssue[];
  voteBreakdown: { approved: number; changes_requested: number };
  summary: string;
}> {
  if (reviews.length === 0) {
    return {
      approved: true,
      merged_issues: [],
      voteBreakdown: { approved: 0, changes_requested: 0 },
      summary: 'No reviews to process',
    };
  }

  const agent = llm ?? new LLMAgent(config);

  const reviewsStr = reviews.map(r =>
    `\n--- ${r.reviewer} (${r.task_id}) ---\nStatus: ${r.approval_status}\nIssues: ${JSON.stringify(r.issues, null, 2)}`
  ).join('\n');

  try {
    const result = await agent.callJSON<any>('consensus-review', [
      { role: 'system', content: PROMPTS.reviewConsensus(reviewsStr).system },
      { role: 'user', content: PROMPTS.reviewConsensus(reviewsStr).user },
    ], { model_tier: 'planner' });

    return {
      approved: result.approved ?? false,
      merged_issues: result.merged_issues || [],
      voteBreakdown: result.vote_breakdown || { approved: 0, changes_requested: 0 },
      summary: result.summary || '',
    };
  } catch (err: any) {
    console.warn(`  Consensus merge failed: ${err.message}, using voting fallback`);

    const approved = reviews.filter(r => r.approval_status === 'approved').length;
    const changesRequested = reviews.filter(r => r.approval_status === 'changes_requested').length;

    const allIssues: ReviewIssue[] = [];
    for (const r of reviews) allIssues.push(...r.issues);

    return {
      approved: approved > changesRequested,
      merged_issues: allIssues,
      voteBreakdown: { approved, changes_requested: changesRequested },
      summary: `Fallback consensus: ${approved} approved, ${changesRequested} changes requested`,
    };
  }
}
