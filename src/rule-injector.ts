/**
 * RuleInjector — 周期性规则提醒注入器
 *
 * 在 orchestrator 长会话中，通过 chat.message hook 每 N 轮用户消息注入一次
 * 精简的规则提醒，防止模型遗忘核心行为准则。
 */

export class RuleInjector {
  /** per-session 计数器: sessionID → 用户消息轮次 */
  private counters = new Map<string, number>();

  /** 每 N 轮用户消息注入一次提醒 */
  private readonly INTERVAL = 5;

  /** 最大保留 session 数（LRU 策略） */
  private readonly MAX_ENTRIES = 200;

  /** 提醒文本模板，{N} 替换为当前轮次 */
  private readonly REMINDER =
    '\n\n[系统规则提醒 — 第{N}轮]\n' +
    '⚠️ 需要改代码？→ 先在本轮输出方案 → todowrite → 等用户确认\n' +
    '⚠️ 要委派 @co-fixer？→ 先确认 todowrite 有 completed 的方案\n' +
    '先检查上面两条，再决定下一步。';

  /**
   * 每次用户消息时调用。
   * @param sessionID 当前会话 ID
   * @returns 需要注入的提醒文本，如果不需要注入则返回 null
   */
  tick(sessionID: string): string | null {
    const count = (this.counters.get(sessionID) ?? 0) + 1;
    this.counters.set(sessionID, count);

    // LRU 清理：超过上限时删除最早添加的条目
    if (this.counters.size > this.MAX_ENTRIES) {
      const firstKey = this.counters.keys().next().value;
      if (firstKey) this.counters.delete(firstKey);
    }

    if (count % this.INTERVAL === 0) {
      return this.REMINDER.replace('{N}', String(count));
    }
    return null;
  }

  /**
   * 清理指定 session 的计数器（session 结束时调用）
   */
  cleanup(sessionID: string): void {
    this.counters.delete(sessionID);
  }

  /**
   * 获取当前活跃的 session 数量（用于监控）
   */
  get activeSessionCount(): number {
    return this.counters.size;
  }
}
