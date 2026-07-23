/**
 * PlanGate 有界审计日志
 *
 * 记录方案批准生命周期事件（批准请求、批准、拒绝、撤销、门禁拦截等）。
 * 有界缓冲区（上限 50 条），原子写入（tmp + rename），
 * 所有方法 fail-open（绝不 throw）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface AuditEvent {
  /** ISO timestamp（由 record() 自动填充） */
  at: string;
  /** 事件类型 */
  event: string;
  /** sessionID 截断前 20 字符 */
  session: string;
  /** 事件发生时该 session 的 generation */
  generation: number;
  /** 被撤销的 generation（仅 revoked 事件） */
  revoked?: number;
  /** 代理名称（如 "co-fixer" / "co-designer"） */
  agent?: string;
  /** 拒绝原因（如 "unapproved" / "permission_rejected"） */
  reason?: string;
  /** 涉及文件数量 */
  fileCount?: number;
  /** 方案摘要长度，不记录原文 */
  summaryLen?: number;
}

// ============================================================================
// BoundedPlanGateAudit
// ============================================================================

export class BoundedPlanGateAudit {
  private events: AuditEvent[] = [];
  private readonly logPath: string;
  private readonly maxEvents = 50;

  /**
   * @param logPath 审计日志文件路径（如 STATE_DIR/plan-gate-audit.json）
   */
  constructor(logPath: string) {
    this.logPath = logPath;
    this.restore();
  }

  // --------------------------------------------------------------------------
  // 恢复
  // --------------------------------------------------------------------------

  /** 从已有文件恢复事件 */
  private restore(): void {
    try {
      const data = fs.readFileSync(this.logPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.events)) {
        this.events = parsed.events;
      }
    } catch {
      // 文件不存在或格式错误，初始化为空数组
      this.events = [];
    }
  }

  // --------------------------------------------------------------------------
  // 记录
  // --------------------------------------------------------------------------

  /**
   * 追加审计事件。
   * 超过 50 条自动裁剪（保留最近 50 条），然后调用 flush()。
   * fail-open：内部错误仅 console.warn，不 throw。
   */
  record(e: Omit<AuditEvent, 'at'>): void {
    try {
      const event: AuditEvent = { ...e, at: new Date().toISOString() };
      this.events.push(event);
      if (this.events.length > this.maxEvents) {
        this.events = this.events.slice(-this.maxEvents);
      }
      this.flush();
    } catch (err) {
      console.warn('[BoundedPlanGateAudit] record 失败:', err);
    }
  }

  // --------------------------------------------------------------------------
  // 写出
  // --------------------------------------------------------------------------

  /**
   * 将当前缓冲区原子写入磁盘（tmp + rename）。
   * fail-open：内部错误仅 console.warn，不 throw。
   */
  flush(): void {
    try {
      const data = JSON.stringify({ version: 1, events: this.events });
      const tmpPath = this.logPath + '.tmp';
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(tmpPath, data, 'utf-8');
      // 原子 rename（Windows 上 renameSync 可能需要先删目标）
      try {
        fs.unlinkSync(this.logPath);
      } catch {
        // 目标不存在，忽略
      }
      fs.renameSync(tmpPath, this.logPath);
    } catch (err) {
      console.warn('[BoundedPlanGateAudit] flush 失败:', err);
    }
  }
}
