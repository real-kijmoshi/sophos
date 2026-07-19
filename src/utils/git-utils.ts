import { simpleGit } from 'simple-git';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GitStatus {
  is_repo: boolean;
  branch: string | null;
  dirty: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface GitDiff {
  file: string;
  hunks: string;
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  try {
    const git = simpleGit(cwd);
    const status = await git.status();
    return {
      is_repo: true,
      branch: status.current || null,
      dirty: !status.isClean(),
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
    };
  } catch {
    return {
      is_repo: false,
      branch: null,
      dirty: false,
      staged: [],
      modified: [],
      untracked: [],
    };
  }
}

export async function getFileDiff(cwd: string, filePath: string): Promise<string> {
  try {
    const git = simpleGit(cwd);
    const diff = await git.diff(['--', filePath]);
    return diff;
  } catch {
    return '';
  }
}

export async function getStagedDiff(cwd: string): Promise<string> {
  try {
    const git = simpleGit(cwd);
    const diff = await git.diff(['--cached']);
    return diff;
  } catch {
    return '';
  }
}

export async function applyDiff(cwd: string, diffContent: string): Promise<boolean> {
  try {
    const tmpFile = path.join(cwd, '.sophos-patch.patch');
    fs.writeFileSync(tmpFile, diffContent, 'utf-8');
    try {
      const check = Bun.spawnSync(['git', 'apply', '--check', tmpFile], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      if (check.exitCode !== 0) {
        fs.unlinkSync(tmpFile);
        return false;
      }
      const apply = Bun.spawnSync(['git', 'apply', tmpFile], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      fs.unlinkSync(tmpFile);
      return apply.exitCode === 0;
    } catch {
      try { fs.unlinkSync(tmpFile); } catch {}
      return false;
    }
  } catch {
    return false;
  }
}

export async function stageFiles(cwd: string, files: string[]): Promise<void> {
  const git = simpleGit(cwd);
  await git.add(files);
}

export async function createCommit(cwd: string, message: string): Promise<string | null> {
  try {
    const git = simpleGit(cwd);
    const result = await git.commit(message);
    return result.commit;
  } catch {
    return null;
  }
}
