// ── Notification Tray ─────────────────────────────────────────────────────────
// Non-intrusive notification system.
// Notifications are queued and printed above the prompt on next render.
// Auto-dismissed after 5 seconds. Ctrl+N flushes the tray.

import { notificationTray, type Notification, c } from './ui.js';

export interface TrayNotification extends Notification {
  id: number;
  createdAt: number;
  dismissed: boolean;
}

const AUTO_DISMISS_MS = 5000;

export class NotificationTrayManager {
  private notifications: TrayNotification[] = [];
  private counter = 0;
  private dismissTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

  // ── Add a notification ───────────────────────────────────────────────────────
  push(type: Notification['type'], message: string): number {
    const id: number = ++this.counter;
    const note: TrayNotification = {
      id,
      type,
      message,
      createdAt: Date.now(),
      dismissed: false,
    };
    this.notifications.push(note);

    // Auto-dismiss after 5s
    const t = setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
    this.dismissTimers.set(id, t);

    return id;
  }

  // ── Convenience helpers ──────────────────────────────────────────────────────
  info(message: string):    number { return this.push('info',    message); }
  success(message: string): number { return this.push('success', message); }
  warning(message: string): number { return this.push('warning', message); }
  error(message: string):   number { return this.push('error',   message); }

  // ── Dismiss ──────────────────────────────────────────────────────────────────
  dismiss(id: number): void {
    const note = this.notifications.find(n => n.id === id);
    if (note) note.dismissed = true;
    const t = this.dismissTimers.get(id);
    if (t) { clearTimeout(t); this.dismissTimers.delete(id); }
    this.prune();
  }

  dismissAll(): void {
    for (const [, t] of this.dismissTimers) clearTimeout(t);
    this.dismissTimers.clear();
    this.notifications.forEach(n => { n.dismissed = true; });
    this.prune();
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  /** Returns the rendered tray string, or '' if empty */
  render(): string {
    this.prune();
    const active = this.active();
    if (!active.length) return '';
    return notificationTray(active);
  }

  /** Print the tray inline (called just before the prompt) */
  printIfAny(): void {
    const rendered = this.render();
    if (rendered) {
      process.stdout.write('\n' + rendered + '\n');
    }
  }

  /** Show full tray with "dismiss all" hint */
  showFull(): void {
    this.prune();
    const active = this.active();
    if (!active.length) {
      console.log(`\n  ${c.muted('No notifications.')}`);
      return;
    }
    console.log('\n' + notificationTray(active));
    console.log(`  ${c.dim('Press Ctrl+N again or type /notifications clear to dismiss all.')}`);
  }

  count(): number {
    this.prune();
    return this.active().length;
  }

  // ── Internals ─────────────────────────────────────────────────────────────────
  private active(): TrayNotification[] {
    return this.notifications.filter(n => !n.dismissed);
  }

  private prune(): void {
    this.notifications = this.notifications.filter(n => !n.dismissed);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const tray = new NotificationTrayManager();
