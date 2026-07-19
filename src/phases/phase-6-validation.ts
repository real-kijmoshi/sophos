import { runCommand, detectBuildCommand } from '../utils/build-runner.js';

export interface ValidationResult {
  build: { success: boolean; output: string; duration_ms: number };
  typecheck: { success: boolean; output: string; duration_ms: number };
  lint: { success: boolean; output: string; duration_ms: number };
  format: { success: boolean; output: string; duration_ms: number };
  unit_tests: { success: boolean; output: string; duration_ms: number };
  integration_tests: { success: boolean; output: string; duration_ms: number };
  overall: boolean;
}

export async function executeAutomatedValidation(targetDir: string): Promise<ValidationResult> {
  const commands = detectBuildCommand(targetDir);

  console.log('  Running build...');
  const buildResult = commands.build
    ? runCommand(commands.build, targetDir)
    : { success: true, command: '', stdout: 'No build command — skipped', stderr: '', duration_ms: 0 };

  if (!buildResult.success) {
    console.log(`    BUILD FAILED:\n${buildResult.stderr.substring(0, 500)}`);
  }

  console.log('  Running type-check...');
  const typecheckResult = commands.typecheck
    ? runCommand(commands.typecheck, targetDir)
    : { success: true, command: '', stdout: 'No typecheck command — skipped', stderr: '', duration_ms: 0 };

  if (!typecheckResult.success) {
    console.log(`    TYPECHECK FAILED:\n${typecheckResult.stderr.substring(0, 500)}`);
  }

  console.log('  Running linter...');
  const lintResult = commands.lint
    ? runCommand(commands.lint, targetDir)
    : { success: true, command: '', stdout: 'No lint command — skipped', stderr: '', duration_ms: 0 };

  console.log('  Running formatter check...');
  const formatResult = commands.format
    ? runCommand(commands.format, targetDir)
    : { success: true, command: '', stdout: 'No format command — skipped', stderr: '', duration_ms: 0 };

  console.log('  Running tests...');
  const testResult = commands.test
    ? runCommand(commands.test, targetDir, 180_000)
    : { success: true, command: '', stdout: 'No test command — skipped', stderr: '', duration_ms: 0 };

  if (!testResult.success) {
    console.log(`    TESTS FAILED:\n${testResult.stderr.substring(0, 500)}`);
  }

  const overall = buildResult.success && typecheckResult.success && lintResult.success &&
    formatResult.success && testResult.success;

  return {
    build: { success: buildResult.success, output: buildResult.stdout + buildResult.stderr, duration_ms: buildResult.duration_ms },
    typecheck: { success: typecheckResult.success, output: typecheckResult.stdout + typecheckResult.stderr, duration_ms: typecheckResult.duration_ms },
    lint: { success: lintResult.success, output: lintResult.stdout + lintResult.stderr, duration_ms: lintResult.duration_ms },
    format: { success: formatResult.success, output: formatResult.stdout + formatResult.stderr, duration_ms: formatResult.duration_ms },
    unit_tests: { success: testResult.success, output: testResult.stdout + testResult.stderr, duration_ms: testResult.duration_ms },
    integration_tests: { success: true, output: 'Skipped', duration_ms: 0 },
    overall,
  };
}
