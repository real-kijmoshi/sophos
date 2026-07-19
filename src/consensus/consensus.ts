import type { ReviewResult, ReviewIssue, ApprovalStatus } from '../types.js';

export interface ConsensusResult {
  approved: boolean;
  merged_issues: ReviewIssue[];
  vote_breakdown: { approved: number; changes_requested: number };
  deadlock: boolean;
}

export function buildConsensus(reviews: ReviewResult[]): ConsensusResult {
  const approved = reviews.filter(r => r.approval_status === 'approved');
  const changesRequested = reviews.filter(r => r.approval_status === 'changes_requested');

  const allIssues: ReviewIssue[] = [];
  for (const review of reviews) {
    allIssues.push(...review.issues);
  }

  const mergedIssues = mergeIssues(allIssues);

  return {
    approved: approved.length >= Math.ceil(reviews.length * 0.6),
    merged_issues: mergedIssues,
    vote_breakdown: {
      approved: approved.length,
      changes_requested: changesRequested.length,
    },
    deadlock: false,
  };
}

function mergeIssues(issues: ReviewIssue[]): ReviewIssue[] {
  const grouped = new Map<string, ReviewIssue[]>();

  for (const issue of issues) {
    const key = `${issue.affected_files.join(',')}|${issue.line_numbers.join(',')}|${issue.category}`;
    const existing = grouped.get(key) || [];
    existing.push(issue);
    grouped.set(key, existing);
  }

  const merged: ReviewIssue[] = [];
  for (const group of grouped.values()) {
    const highest = group.reduce((prev, curr) =>
      severityWeight(curr.severity) > severityWeight(prev.severity) ? curr : prev
    );
    merged.push(highest);
  }

  return merged.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
}

function severityWeight(severity: string): number {
  switch (severity) {
    case 'critical': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

export function resolveConflicts(
  conflictingReviews: ReviewResult[][]
): { taskId: string; resolution: 'approved' | 'changes_requested'; issues: ReviewIssue[] }[] {
  const resolutions: { taskId: string; resolution: 'approved' | 'changes_requested'; issues: ReviewIssue[] }[] = [];

  const taskIds = new Set(conflictingReviews.flat().map(r => r.task_id));

  for (const taskId of taskIds) {
    const taskReviews = conflictingReviews.flat().filter(r => r.task_id === taskId);
    const consensus = buildConsensus(taskReviews);

    resolutions.push({
      taskId,
      resolution: consensus.approved ? 'approved' : 'changes_requested',
      issues: consensus.merged_issues,
    });
  }

  return resolutions;
}
