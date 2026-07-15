import type { ContextStrategy } from '../context/types';

export type TaskStatus = 'running' | 'completed' | 'errored' | 'cancelled';

export interface JobRecord {
  alias: string;            // 如 "fix-1", "exp-2"
  sessionId: string;        // 子代理 session ID（如有）
  parentSessionId: string;
  agent: string;            // 子代理类型（fixer/explorer/...）
  label: string;            // 任务描述
  status: TaskStatus;
  background: boolean;      // 是否是后台任务
  terminalReconciled: boolean;
  createdAt: number;        // Date.now()
  /** 此子代理的上下文策略 */
  contextStrategy?: ContextStrategy;
  /** 依赖的前置任务别名列表 */
  dependencies?: string[];
}

export interface TaskArgs {
  description?: string;
  subagent_type?: string;
  task_id?: string;
  background?: boolean;
}
