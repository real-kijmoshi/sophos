export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  is_new: boolean;
  is_deleted: boolean;
}

export function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  oldPath: string,
  newPath: string
): string {
  if (oldContent === newContent) return '';
  if (!oldContent) return createNewFileDiff(newContent, newPath);
  if (!newContent) return createDeletedFileDiff(oldContent, oldPath);

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const hunks = computeDiffHunks(oldLines, newLines);

  if (hunks.length === 0) return '';

  let diff = `--- a/${oldPath}\n+++ b/${newPath}\n`;
  for (const hunk of hunks) {
    diff += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
    diff += hunk.content + '\n';
  }
  return diff;
}

function computeDiffHunks(oldLines: string[], newLines: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lcs = lcsMatrix(oldLines, newLines);
  const changes = extractChanges(oldLines, newLines, lcs);

  let i = 0;
  while (i < changes.length) {
    const start = i;
    while (i < changes.length && changes[i].type !== 'context') i++;
    if (i < changes.length) i++;
    const end = i;

    const changeSlice = changes.slice(start, end);
    const oldStart = changeSlice.find(c => c.oldLine !== undefined)?.oldLine ?? 1;
    const newStart = changeSlice.find(c => c.newLine !== undefined)?.newLine ?? 1;

    let oldCount = 0;
    let newCount = 0;
    let content = '';

    for (const change of changeSlice) {
      if (change.type === 'delete') {
        content += '-' + change.value + '\n';
        oldCount++;
      } else if (change.type === 'insert') {
        content += '+' + change.value + '\n';
        newCount++;
      } else {
        content += ' ' + change.value + '\n';
        oldCount++;
        newCount++;
      }
    }

    hunks.push({
      oldStart,
      oldLines: oldCount,
      newStart,
      newLines: newCount,
      content: content.trimEnd(),
    });
  }

  return hunks;
}

function lcsMatrix(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

interface Change {
  type: 'context' | 'insert' | 'delete';
  value: string;
  oldLine?: number;
  newLine?: number;
}

function extractChanges(oldLines: string[], newLines: string[], dp: number[][]): Change[] {
  const changes: Change[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      changes.unshift({ type: 'context', value: oldLines[i - 1], oldLine: i, newLine: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ type: 'insert', value: newLines[j - 1], newLine: j });
      j--;
    } else {
      changes.unshift({ type: 'delete', value: oldLines[i - 1], oldLine: i });
      i--;
    }
  }

  return changes;
}

function createNewFileDiff(content: string, path: string): string {
  const lines = content.split('\n');
  let diff = `--- /dev/null\n+++ b/${path}\n`;
  diff += `@@ -0,0 +1,${lines.length} @@\n`;
  diff += lines.map(l => '+' + l).join('\n');
  return diff;
}

function createDeletedFileDiff(content: string, path: string): string {
  const lines = content.split('\n');
  let diff = `--- a/${path}\n+++ /dev/null\n`;
  diff += `@@ -1,${lines.length} +0,0 @@\n`;
  diff += lines.map(l => '-' + l).join('\n');
  return diff;
}

export function parseDiffFiles(diff: string): string[] {
  const files: string[] = [];
  const regex = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let match;
  while ((match = regex.exec(diff))) {
    files.push(match[2]);
  }
  return files;
}
