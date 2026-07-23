/**
 * PlanGate — 方案批准门禁系统
 *
 * 管理 orchestrator session 的方案批准生命周期。
 * 每次用户消息递增 generation 并撤销旧批准，
 * 通过 request_plan_approval 工具和 ctx.ask() 实现原生确认框门禁。
 */

import { tool } from '@opencode-ai/plugin';
import { BoundedPlanGateAudit, type AuditEvent } from './plan-gate-audit';

// ============================================================================
// Types
// ============================================================================

export interface PlanInfo {
  summary: string;
  files: string[];
  verification: string;
}

interface SessionPlanState {
  generation: number;
  approvedGeneration?: number;
  plan?: PlanInfo;
}

// ============================================================================
// PlanApprovalManager
// ============================================================================

export class PlanApprovalManager {
  /** sessionID → SessionPlanState */
  private sessions = new Map<string, SessionPlanState>();
  /** 有界审计日志（可选） */
  readonly audit?: BoundedPlanGateAudit;

  /**
   * @param audit 可选的审计日志实例
   */
  constructor(audit?: BoundedPlanGateAudit) {
    this.audit = audit;
  }

  /**
   * 获取指定 session 当前 generation（用于审计记录）。
   */
  getGeneration(sessionID: string): number {
    return this.sessions.get(sessionID)?.generation ?? 0;
  }

  /**
   * 观察用户消息。仅在 orchestrator session 上建立状态。
   * @param sessionID 当前 session ID
   * @param agent 当前 agent 名称
   * @returns 是否为此 session 建立了/更新了状态
   */
  observeUserMessage(sessionID: string, agent?: string): boolean {
    // 只有 orchestrator 消息才建立/更新状态
    if (agent !== 'co-orchestrator') {
      // 如果 session 已登记（首次消息是 orchestrator），后续消息即使 agent 缺省也应处理
      if (!this.sessions.has(sessionID)) {
        return false;
      }
    }

    const state = this.sessions.get(sessionID) ?? { generation: 0 };
    const oldApprovedGeneration = state.approvedGeneration;
    state.generation += 1;
    // 撤销旧批准
    delete state.approvedGeneration;
    delete state.plan;
    this.sessions.set(sessionID, state);

    // 审计记录：撤销旧批准（revoked 字段指明被撤销的 generation）
    this.audit?.record({
      event: 'revoked',
      session: sessionID.slice(0, 20),
      generation: state.generation,
      revoked: oldApprovedGeneration,
      agent: agent && agent !== 'co-orchestrator' ? agent : undefined,
    });

    return true;
  }

  /**
   * 批准当前 generation 的方案。
   * 仅当 session 已被 observeUserMessage 登记且指定了 generation 时可用。
   * @throws 如果 session 未被观察
   */
  approve(sessionID: string, plan: PlanInfo): void {
    const state = this.sessions.get(sessionID);
    if (!state) {
      throw new Error(
        `Session "${sessionID.slice(0, 20)}..." 尚未被 PlanGate 观察，无法批准。` +
        '只有 co-orchestrator 的 session 才能建立批准状态。',
      );
    }
    if (state.generation === 0) {
      throw new Error('无法批准 generation 0——session 尚未处理任何用户消息。');
    }
    state.approvedGeneration = state.generation;
    state.plan = plan;

    // 审计记录：方案批准
    this.audit?.record({
      event: 'approved',
      session: sessionID.slice(0, 20),
      generation: state.generation,
      fileCount: plan.files.length,
      summaryLen: plan.summary.length,
    });
  }

  /**
   * 检查当前 generation 是否已批准。
   */
  isApproved(sessionID: string): boolean {
    const state = this.sessions.get(sessionID);
    if (!state) return false;
    return state.approvedGeneration === state.generation && state.generation > 0;
  }

  /**
   * 生成 session 的动态系统上下文（精简 XML 片段）。
   * 仅对已登记的 orchestrator session 返回内容。
   */
  getSystemContext(sessionID: string): string {
    const state = this.sessions.get(sessionID);
    if (!state) return '';
    const approved = this.isApproved(sessionID);
    return `<plan_gate generation="${state.generation}" approved="${approved}">\n` +
      `  generation: ${state.generation}\n` +
      `  approved: ${approved}\n` +
      (state.plan
        ? `  plan_summary: ${state.plan.summary.slice(0, 120)}\n` +
          `  plan_files: ${state.plan.files.slice(0, 5).join(', ')}${state.plan.files.length > 5 ? '...' : ''}\n`
        : '') +
      `</plan_gate>`;
  }

  /**
   * 生成注入到消息末尾的行为准则文本（利用 recency bias 对抗注意力衰减）。
   * 仅对已观察的 orchestrator session 返回内容，否则返回 null。
   * 不超过 25 行，不持久化到 DB（由调用方注入到 messages.transform）。
   */
  getInjectionText(sessionID: string): string | null {
    const state = this.sessions.get(sessionID);
    if (!state || state.generation === 0) return null;
    const approved = this.isApproved(sessionID);
    const status = approved ? '已批准' : '未批准';
    const lines: string[] = [];

    lines.push('');
    lines.push('--- 行为准则（本次 LLM 请求注入，不持久化） ---');
    lines.push(`当前 generation: ${state.generation}，方案状态: ${status}`);
    lines.push('');
    lines.push('核心规则：');
    lines.push('1. 需要改代码 -> 先输出方案 -> todowrite -> request_plan_approval -> 等弹窗确认');
    lines.push('2. 文件操作 -> 委派子代理，禁止亲自使用 read/grep/edit/bash/write');
    lines.push('3. 未批准方案时禁止委派 co-fixer / co-designer');
    lines.push('4. 每个新用户消息自动撤销旧批准');
    lines.push('');
    if (approved) {
      lines.push('可委派 co-fixer / co-designer');
      lines.push('');
    }
    lines.push('自检：需要改代码？-> 先方案  委派 fixer？-> 查状态锁');
    lines.push('--- 注入结束 ---');

    return lines.join('\n');
  }

  /**
   * 清理指定 session 的状态。
   */
  cleanup(sessionID: string): void {
    this.sessions.delete(sessionID);
  }

  /**
   * 当前活跃的 orchestrator session 数量（用于监控）。
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }
}

// ============================================================================
// request_plan_approval 工具
// ============================================================================

const z = tool.schema;

/**
 * 创建 request_plan_approval 自定义工具。
 *
 * 参数：
 *   - summary: string —— 方案摘要
 *   - files: string[] —— 涉及文件列表
 *   - verification: string —— 验证方式
 *
 * 在 execute 内通过 ctx.ask() 发起原生确认框，
 * 用户允许后写入批准状态。拒绝则不批准。
 */
export function createRequestPlanApprovalTool(
  planManager: PlanApprovalManager,
): Record<string, ReturnType<typeof tool>> {
  const request_plan_approval = tool({
    description: [
      '请求用户批准当前执行方案。',
      '',
      '输出方案后调用此工具，会弹出原生确认框让用户确认。',
      '只有用户确认后，co-fixer 和 co-designer 等可写代理才能执行。',
      '新用户消息会自动撤销之前的批准，需要重新申请。',
      '',
      '调用前确保已向用户展示了完整的任务分解方案。',
    ].join('\n'),

    args: {
      summary: z.string().describe(
        '方案摘要：简要说明做什么、为什么',
      ),
      files: z.array(z.string()).describe(
        '涉及的文件列表（相对路径）',
      ),
      verification: z.string().describe(
        '验证方式：如何确认变更正确（如编译、测试、审查）',
      ),
    },

    async execute(
      args: { summary: string; files: string[]; verification: string },
      toolContext: { sessionID: string; agent: string },
    ): Promise<string> {
      const sessionID = toolContext.sessionID;
      const summary = String(args.summary);
      const files: string[] = Array.isArray(args.files) ? args.files.map(String) : [];
      const verification = String(args.verification);

      // 截断避免超长 permission pattern
      const truncatedSummary = summary.length > 200 ? summary.slice(0, 200) + '...' : summary;
      const truncatedFiles = files.length > 8
        ? [...files.slice(0, 8), `...等 ${files.length} 个文件`]
        : files;
      const truncatedVerification = verification.length > 150
        ? verification.slice(0, 150) + '...'
        : verification;

      // 当前 generation
      const currentGen = planManager.getGeneration(sessionID);

      // 审计记录：请求批准
      planManager.audit?.record({
        event: 'approval_requested',
        session: sessionID.slice(0, 20),
        generation: currentGen,
        agent: 'co-orchestrator',
        fileCount: files.length,
        summaryLen: summary.length,
      });

      // 发起原生确认框
      try {
        await (toolContext as unknown as { ask: (input: { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> }) => Promise<void> }).ask({
          permission: 'plan-execute',
          always: [],
          patterns: [
            `📋 方案: ${truncatedSummary}`,
            `📁 文件 (${files.length}个): ${truncatedFiles.join(', ')}`,
            `🔍 验证: ${truncatedVerification}`,
          ],
          metadata: {
            session_id: sessionID,
            generation: String(currentGen),
            summary,
            file_count: String(files.length),
          },
        });
      } catch (err) {
        // 用户拒绝确认框
        planManager.audit?.record({
          event: 'rejected',
          session: sessionID.slice(0, 20),
          generation: currentGen,
          reason: 'permission_rejected',
        });
        throw err;
      }

      // ask 成功（用户允许）后写入批准（approve 内部自动记录 'approved' 审计事件）
      planManager.approve(sessionID, { summary, files, verification });

      return (
        `✅ 方案已批准（generation ${currentGen}）。\n` +
        `现在可以委派 @co-fixer / @co-designer 执行。\n` +
        `📋 ${summary}\n` +
        `📁 ${files.length} 个文件\n` +
        `🔍 ${verification}`
      );
    },
  });

  return { request_plan_approval };
}
