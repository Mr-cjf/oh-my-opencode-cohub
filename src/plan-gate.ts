/**
 * PlanGate — 方案批准门禁系统
 *
 * 管理 orchestrator session 的方案批准生命周期。
 * 每次用户消息递增 generation 并撤销旧批准，
 * 通过 request_plan_approval 工具和 ctx.ask() 实现原生确认框门禁。
 */

import { tool } from '@opencode-ai/plugin';

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
    state.generation += 1;
    // 撤销旧批准
    delete state.approvedGeneration;
    delete state.plan;
    this.sessions.set(sessionID, state);
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

      // 发起原生确认框
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
          generation: String(planManager['sessions']?.get(sessionID)?.generation ?? 0),
          summary,
          file_count: String(files.length),
        },
      });

      // ask 成功（用户允许）后写入批准
      planManager.approve(sessionID, { summary, files, verification });

      return (
        `✅ 方案已批准（generation ${planManager['sessions']?.get(sessionID)?.generation ?? '?'}）。\n` +
        `现在可以委派 @co-fixer / @co-designer 执行。\n` +
        `📋 ${summary}\n` +
        `📁 ${files.length} 个文件\n` +
        `🔍 ${verification}`
      );
    },
  });

  return { request_plan_approval };
}
