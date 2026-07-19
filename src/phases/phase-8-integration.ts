import type { IntegrationResult } from '../types.js';
import type { CodingOutput } from './phase-4-coding.js';
import { readFileContent, writeFileContent } from '../utils/file-scanner.js';
import { applyDiff } from '../utils/git-utils.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

export async function executeIntegration(
  outputs: Map<string, CodingOutput>,
  targetDir: string
): Promise<IntegrationResult> {
  const result: IntegrationResult = {
    integration_status: 'success',
    merged_patches: [],
    conflicts_resolved: 0,
    conflicts_manual: 0,
    integrity_check: 'passed',
    errors: [],
  };

  const sortedOutputs = sortOutputsByDependency(outputs);

  for (const [taskId, output] of sortedOutputs) {
    try {
      for (const [filePath, content] of output.generated_files) {
        const fullPath = path.join(targetDir, filePath);
        const existing = readFileContent(fullPath);

        if (existing && existing !== content && output.unified_diff) {
          const success = await applyDiff(targetDir, output.unified_diff);
          if (success) {
            result.conflicts_resolved++;
          } else {
            writeFileContent(fullPath, content);
            result.conflicts_manual++;
          }
        } else {
          writeFileContent(fullPath, content);
        }
      }
      result.merged_patches.push(taskId);
    } catch (err: any) {
      result.errors.push(`Error merging ${taskId}: ${err.message}`);
      result.conflicts_manual++;
    }
  }

  if (result.errors.length > 0) {
    result.integration_status = result.errors.length > sortedOutputs.size / 2 ? 'failure' : 'success';
  }

  try {
    await verifyImports(targetDir, outputs);
  } catch (err: any) {
    result.integrity_check = 'failed';
    result.errors.push(`Import verification: ${err.message}`);
  }

  return result;
}

function sortOutputsByDependency(
  outputs: Map<string, CodingOutput>
): Map<string, CodingOutput> {
  const sorted = new Map<string, CodingOutput>();
  for (const [taskId, output] of outputs) {
    sorted.set(taskId, output);
  }
  return sorted;
}

async function verifyImports(
  targetDir: string,
  outputs: Map<string, CodingOutput>
): Promise<void> {
  for (const [taskId, output] of outputs) {
    for (const filePath of output.files_changed) {
      const fullPath = path.join(targetDir, filePath);
      const content = readFileContent(fullPath);

      const importRegex = /(?:import|from)\s+(?:.*?from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content))) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          const resolved = path.resolve(path.dirname(fullPath), importPath);
          const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs'];
          const exists = extensions.some(ext =>
            fs.existsSync(resolved + ext) || fs.existsSync(path.join(resolved, 'index' + ext))
          );
          if (!exists) {
            console.warn(`  WARNING: Import "${importPath}" in ${filePath} may not resolve`);
          }
        }
      }
    }
  }
}
