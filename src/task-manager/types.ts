export type TaskStatus = 'running' | 'completed' | 'errored' | 'cancelled';

export interface JobRecord {
  alias: string;            // 如 "fix-1", "exp-2"
  sessionId: string;        // 子代理 session ID（如有）
  parentSessionId: string;
  agent: string;            // 子代理类型（fixer/explorer/...）
  label: string;            // 任务描述
  status: TaskStatus;
  terminalReconciled: boolean;
  createdAt: number;        // Date.now()
}

export interface TaskArgs {
  description?: string;
  subagent_type?: string;
  task_id?: string;
  background?: boolean;
}
