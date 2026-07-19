import { simpleGit } from 'simple-git';
type SimpleGit = ReturnType<typeof simpleGit>;

export interface GitInfo {
  isRepo: boolean;
  branch: string;
  remote: string;
  staged: string[];
  modified: string[];
  notAdded: string[];
  deleted: string[];
  isClean: boolean;
  recentCommits: { hash: string; message: string; author: string }[];
}

export class GitIntegration {
  private git: SimpleGit;

  constructor(projectDir: string) {
    this.git = simpleGit(projectDir);
  }

  async getInfo(): Promise<GitInfo> {
    const empty: GitInfo = { isRepo: false, branch: '', remote: '', staged: [], modified: [], notAdded: [], deleted: [], isClean: true, recentCommits: [] };
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) return empty;

      const [branchResult, statusResult, logResult] = await Promise.allSettled([
        this.git.branch(),
        this.git.status(),
        this.git.log({ maxCount: 10 }),
      ]);

      const branch = branchResult.status === 'fulfilled' ? branchResult.value.current : 'unknown';
      const remote = branchResult.status === 'fulfilled' ? ((branchResult.value as any).tracking || 'none') : 'none';
      const status = statusResult.status === 'fulfilled' ? statusResult.value : null;
      const commits = logResult.status === 'fulfilled' ? logResult.value.all.map(c => ({ hash: (c.hash || '').slice(0, 7), message: c.message || '', author: c.author_name || '' })) : [];

      return {
        isRepo: true,
        branch,
        remote,
        staged: status?.staged || [],
        modified: status?.modified || [],
        notAdded: status?.not_added || [],
        deleted: status?.deleted || [],
        isClean: status?.isClean?.() ?? true,
        recentCommits: commits,
      };
    } catch {
      return empty;
    }
  }

  async getDiff(file?: string): Promise<string> {
    try {
      return file ? await this.git.diff([file]) : await this.git.diff();
    } catch { return ''; }
  }

  async getLog(count = 10): Promise<{ hash: string; message: string; author: string }[]> {
    try {
      const log = await this.git.log({ maxCount: count });
      return log.all.map(c => ({ hash: (c.hash || '').slice(0, 7), message: c.message || '', author: c.author_name || '' }));
    } catch { return []; }
  }

  async stageFiles(files: string[]): Promise<void> { await this.git.add(files); }
  async addAll(): Promise<void> { await this.git.add('-A'); }
  async commit(message: string): Promise<string | null> {
    try { const r = await this.git.commit(message); return r.commit; } catch { return null; }
  }
  async push(remote?: string, branch?: string): Promise<boolean> {
    try {
      const remoteName = remote || 'origin';
      const branchName = branch || (await this.git.branch()).current;
      await this.git.push(remoteName, branchName);
      return true;
    } catch { return false; }
  }
  async hasRemote(): Promise<boolean> {
    try {
      const remotes = await this.git.getRemotes();
      return remotes.length > 0;
    } catch { return false; }
  }
  async createBranch(name: string): Promise<void> { await this.git.checkoutLocalBranch(name); }
  async stash(): Promise<boolean> { try { await this.git.stash(); return true; } catch { return false; } }
  async stashPop(): Promise<boolean> { try { await (this.git as any).stash(['pop']); return true; } catch { return false; } }

  formatStatus(info: GitInfo): string {
    const lines: string[] = [];
    lines.push(`Branch: ${info.branch}`);
    if (info.remote !== 'none') lines.push(`Tracking: ${info.remote}`);
    if (info.staged.length) { lines.push(`\nStaged (${info.staged.length}):`); info.staged.slice(0, 10).forEach(f => lines.push(`  + ${f}`)); }
    if (info.modified.length) { lines.push(`\nModified (${info.modified.length}):`); info.modified.slice(0, 10).forEach(f => lines.push(`  ~ ${f}`)); }
    if (info.notAdded.length) { lines.push(`\nUntracked (${info.notAdded.length}):`); info.notAdded.slice(0, 10).forEach(f => lines.push(`  ? ${f}`)); }
    if (info.deleted.length) { lines.push(`\nDeleted (${info.deleted.length}):`); info.deleted.slice(0, 10).forEach(f => lines.push(`  - ${f}`)); }
    if (info.recentCommits.length) { lines.push('\nRecent Commits:'); info.recentCommits.slice(0, 5).forEach(c => lines.push(`  ${c.hash} ${c.message.slice(0, 50)}`)); }
    return lines.join('\n');
  }
}
