export interface BuildResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export function runCommand(command: string, cwd: string, timeoutMs = 120_000): BuildResult {
  const start = Date.now();
  const proc = Bun.spawnSync(['sh', '-c', command], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  if (proc.exitCode === 0) {
    return {
      success: true,
      command,
      stdout: proc.stdout?.toString() ?? '',
      stderr: '',
      duration_ms: Date.now() - start,
    };
  }
  return {
    success: false,
    command,
    stdout: proc.stdout?.toString() ?? '',
    stderr: proc.stderr?.toString() ?? '',
    duration_ms: Date.now() - start,
  };
}

import * as fs from 'node:fs';
import * as path from 'node:path';

export function detectBuildCommand(cwd: string): {
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
  format?: string;
} {
  const result: ReturnType<typeof detectBuildCommand> = {};

  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      const scripts = pkg.scripts || {};
      if (scripts.build) result.build = 'npm run build';
      if (scripts.test) result.test = 'npm test';
      if (scripts.lint) result.lint = 'npm run lint';
      if (scripts.typecheck || scripts['type-check']) result.typecheck = `npm run ${scripts.typecheck ? 'typecheck' : 'type-check'}`;
      if (scripts.format || scripts.prettier) result.format = `npm run ${scripts.format ? 'format' : 'prettier'}`;
      if (!result.typecheck) result.typecheck = 'npx tsc --noEmit';
      if (!result.lint) result.lint = 'npx eslint .';
    } catch { /* ignore */ }
  } else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    result.build = 'cargo build';
    result.test = 'cargo test';
    result.lint = 'cargo clippy -- -D warnings';
    result.typecheck = 'cargo check';
  } else if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    result.build = 'go build ./...';
    result.test = 'go test ./...';
    result.lint = 'golangci-lint run';
  } else if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'setup.py'))) {
    result.test = 'pytest';
    result.lint = 'ruff check .';
    result.typecheck = 'mypy .';
  } else if (fs.existsSync(path.join(cwd, 'requirements.txt'))) {
    result.test = 'pytest';
    result.lint = 'ruff check .';
    result.typecheck = 'mypy .';
  }

  return result;
}
