// src/tools/job-control.ts
//
// close_job tool for oh-my-opencode-cohub.
// 允许主代理（co-orchestrator）关闭一个卡住或不必要的子代理后台任务：
// 通过 tracker.abortJob() 同步任务状态（标记 cancelled），并通过
// ctx.client.session.abort() 真正中止底层子代理 session。

import { tool } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import type { TaskTracker } from '../task-manager/tracker.js';
import { appendLog } from '../utils/log.js';

// zod access via tool.schema（与 council.ts 相同的模式）
const z = tool.schema;

/**
 * 创建 close_job 工具定义。
 *
 * 仅 co-orchestrator（主代理）允许调用（纵深防御，与权限配置层配合）。
 *
 * @param ctx      插件 input（提供 client 以调用 session.abort）
 * @param tracker  TaskTracker 实例（用于 abortJob 状态同步）
 * @param onClosed 可选回调：关闭成功后刷新状态（如 syncTrackerState）
 */
export function createCloseJobTool(
  ctx: PluginInput,
  tracker: TaskTracker,
  onClosed?: () => void,
): Record<string, ReturnType<typeof tool>> {
  const close_job = tool({
    description:
      'Close (abort) a stuck or unnecessary subagent background task. ' +
      'Accepts the child Session ID (e.g. ses_xxx, shown in the Background Job Board) or the task alias (e.g. coe-1). ' +
      'The underlying subagent session is aborted via session.abort() and the task is marked cancelled. ' +
      'Only the co-orchestrator (primary) agent may invoke this tool.',

    args: {
      task_id: z.string().describe(
        'The child session ID (ses_xxx) or task alias (e.g. coe-1) of the task to close.',
      ),
    },

    async execute(
      args: { task_id: string },
      toolContext: { sessionID: string; agent: string },
    ): Promise<string> {
      // 权限校验（纵深防御）：仅 co-orchestrator；缺失身份视为拒绝
      if (toolContext.agent !== 'co-orchestrator') {
        throw new Error(
          `[oh-my-opencode-cohub] close_job can only be invoked by co-orchestrator. Current agent: ${toolContext.agent}`,
        );
      }

      const hit = tracker.abortJob(args.task_id);
      if (!hit) {
        return JSON.stringify({ ok: false, task_id: args.task_id, reason: 'not_found' }, null, 2);
      }

      let aborted = false;
      if (hit.sessionId) {
        // SDK 默认 ThrowOnError=false：HTTP 4xx/5xx 会 resolve 出 { data, error } 而非 reject，
        // 必须显式检查 res.error 判别失败（catch 仅兜底网络层异常）
        const res = await ctx.client.session.abort({ path: { id: hit.sessionId } });
        if (res.error) {
          appendLog('job-control', `abort session ${hit.sessionId} 失败`, res.error);
          aborted = false;
        } else {
          aborted = true;
        }
      }

      onClosed?.();

      return JSON.stringify(
        {
          ok: true,
          task_id: args.task_id,
          alias: hit.job?.alias,
          agent: hit.job?.agent,
          session_aborted: aborted,
          status: 'cancelled',
        },
        null,
        2,
      );
    },
  });

  return { close_job };
}
