// ── Command Palette ───────────────────────────────────────────────────────────
// Live dropdown that appears under the input as soon as you type “/”.
// Filters commands as you type, supports subcommand completion, and is driven
// by the LineEditor's below-region + intercept hooks:
//
//   ↑/↓   move selection          tab  complete into the input
//   ↵     run selected command    esc  dismiss until the input changes
//
// This is what makes the prompt feel like Claude Code / OpenCode.

import { ALL_COMMANDS, COMMAND_COMPLETIONS } from './intent-parser.js';
import { c, panelTop, panelRow, panelBottom } from './ui.js';

export interface PaletteItem {
  /** Full text inserted into the input when accepted. */
  insert: string;
  /** Display label (left column). */
  label:  string;
  /** Dim description (right column). */
  desc:   string;
  /** Whether accepting with Tab should append a space (has subcommands). */
  hasArgs: boolean;
}

const MAX_VISIBLE = 6;

export class CommandPalette {
  visible = false;

  private items:    PaletteItem[] = [];
  private selected  = 0;
  private scrollTop = 0;
  private dismissedFor: string | null = null;

  /** Recompute items from the current input line. Call on every change. */
  update(line: string): void {
    const t = line.trimStart();

    if (this.dismissedFor !== null && t !== this.dismissedFor) this.dismissedFor = null;
    if (!t.startsWith('/') || this.dismissedFor === t) { this.hide(); return; }

    this.items = t.includes(' ') ? this.subcommandItems(t) : this.topLevelItems(t);

    if (!this.items.length) { this.hide(); return; }
    this.selected  = Math.min(this.selected, this.items.length - 1);
    this.scrollTop = Math.min(this.scrollTop, Math.max(0, this.items.length - MAX_VISIBLE));
    this.ensureVisible();
    this.visible = true;
  }

  nav(delta: number): void {
    if (!this.visible || !this.items.length) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.ensureVisible();
  }

  current(): PaletteItem | null {
    return this.visible ? this.items[this.selected] ?? null : null;
  }

  /** Hide until the input line changes again. */
  dismiss(line: string): void {
    this.dismissedFor = line.trimStart();
    this.hide();
  }

  hide(): void {
    this.visible   = false;
    this.items     = [];
    this.selected  = 0;
    this.scrollTop = 0;
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /**
   * Render the dropdown. With `width`, draws a rounded bordered panel (TUI);
   * without, falls back to the plain inline style (REPL below-region).
   */
  renderLines(width?: number): string[] {
    if (!this.visible || !this.items.length) return [];

    const end    = Math.min(this.items.length, this.scrollTop + MAX_VISIBLE);
    const labelW = Math.min(24, Math.max(...this.items.map(i => i.label.length)) + 2);

    if (width !== undefined) {
      const lines: string[] = [];
      const count = this.items.length;
      lines.push('  ' + panelTop(width - 4, c.dim(`${count} command${count !== 1 ? 's' : ''}`)));
      if (this.scrollTop > 0) lines.push('  ' + panelRow(c.dim(`↑ ${this.scrollTop} more`), width - 4));
      for (let i = this.scrollTop; i < end; i++) {
        const it  = this.items[i];
        const sel = i === this.selected;
        const pad = it.label.padEnd(labelW);
        lines.push('  ' + panelRow(sel
          ? `${c.accent('❯')} ${c.accent.bold(pad)}${c.text(it.desc)}`
          : `  ${c.muted(pad)}${c.dim(it.desc)}`, width - 4));
      }
      const remaining = this.items.length - end;
      if (remaining > 0) lines.push('  ' + panelRow(c.dim(`↓ ${remaining} more`), width - 4));
      lines.push('  ' + panelBottom(width - 4, c.dim('↑↓ · tab · ↵ · esc')));
      return lines;
    }

    const lines: string[] = [];
    if (this.scrollTop > 0) lines.push(`    ${c.dim(`… ${this.scrollTop} more`)}`);

    for (let i = this.scrollTop; i < end; i++) {
      const it  = this.items[i];
      const sel = i === this.selected;
      const pad = it.label.padEnd(labelW);
      lines.push(sel
        ? `  ${c.accent('❯')} ${c.accent.bold(pad)}${c.text(it.desc)}`
        : `    ${c.dim(pad)}${c.muted(it.desc)}`);
    }

    const remaining = this.items.length - end;
    if (remaining > 0) lines.push(`    ${c.dim(`… ${remaining} more`)}`);

    lines.push(`  ${c.dim('↑↓ select   tab complete   ↵ run   esc dismiss')}`);
    return lines;
  }

  // ── Item sources ────────────────────────────────────────────────────────────

  private topLevelItems(t: string): PaletteItem[] {
    const q = t.slice(1).toLowerCase();

    const scored: Array<{ item: PaletteItem; score: number }> = [];
    for (const cmd of ALL_COMMANDS) {
      const names = [cmd.name, ...(cmd.aliases ?? [])].map(n => n.slice(1).toLowerCase());
      let score = -1;
      if (!q)                                          score = 50;
      else if (names[0].startsWith(q))                 score = 0;
      else if (names.some(n => n.startsWith(q)))       score = 10;
      else if (names[0].includes(q))                   score = 20;
      else if (isSubsequence(q, names[0]))             score = 30;
      else if (cmd.desc.toLowerCase().includes(q))     score = 40;
      if (score < 0) continue;
      scored.push({
        score,
        item: {
          insert:  cmd.name,
          label:   cmd.name,
          desc:    cmd.desc,
          hasArgs: Boolean(COMMAND_COMPLETIONS[cmd.name]?.length),
        },
      });
    }
    scored.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
    return scored.map(s => s.item);
  }

  private subcommandItems(t: string): PaletteItem[] {
    // Longest-prefix match so “/models save l” resolves against “/models save”.
    const entries = Object.entries(COMMAND_COMPLETIONS)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [prefix, subs] of entries) {
      if (t === prefix || t.startsWith(prefix + ' ')) {
        const after = t.slice(prefix.length).trimStart().toLowerCase();
        const hits  = subs.filter(s => s.toLowerCase().startsWith(after));
        return hits.map(s => ({
          insert:  `${prefix} ${s}`,
          label:   s,
          desc:    '',
          hasArgs: Boolean(COMMAND_COMPLETIONS[`${prefix} ${s}`]?.length),
        }));
      }
    }
    return [];
  }

  private ensureVisible(): void {
    if (this.selected < this.scrollTop)                   this.scrollTop = this.selected;
    if (this.selected >= this.scrollTop + MAX_VISIBLE)    this.scrollTop = this.selected - MAX_VISIBLE + 1;
  }
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
