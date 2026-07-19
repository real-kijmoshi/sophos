export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
  operation: string;
}

export class CostTracker {
  private entries: CostEntry[] = [];

  track(model: string, inputTokens: number, outputTokens: number, operation: string): void {
    this.entries.push({ model, inputTokens, outputTokens, timestamp: Date.now(), operation });
  }

  trackFromText(model: string, inputText: string, outputText: string, operation: string): void {
    this.track(model, Math.ceil(inputText.length / 3.5), Math.ceil(outputText.length / 3.5), operation);
  }

  formatSummary(): string {
    const totalInput = this.entries.reduce((s, e) => s + e.inputTokens, 0);
    const totalOutput = this.entries.reduce((s, e) => s + e.outputTokens, 0);
    const lines: string[] = [];
    lines.push('Cost Summary:');
    lines.push('─'.repeat(40));
    lines.push(`  Total Tokens: ${fmtNum(totalInput + totalOutput)}`);
    lines.push(`  Input: ${fmtNum(totalInput)}  Output: ${fmtNum(totalOutput)}`);
    lines.push(`  Operations: ${this.entries.length}`);
    const byModel = new Map<string, { tokens: number; count: number }>();
    for (const e of this.entries) {
      const existing = byModel.get(e.model) || { tokens: 0, count: 0 };
      existing.tokens += e.inputTokens + e.outputTokens;
      existing.count++;
      byModel.set(e.model, existing);
    }
    if (byModel.size > 0) {
      lines.push('  By Model:');
      for (const [model, data] of byModel) {
        lines.push(`    ${model}: ${fmtNum(data.tokens)} tokens (${data.count} calls)`);
      }
    }
    return lines.join('\n');
  }

  clear(): void { this.entries = []; }
}

function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
