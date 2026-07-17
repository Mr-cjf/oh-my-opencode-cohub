import type { ContextStrategy } from '../context/types';
export type TaskStatus = 'running' | 'completed' | 'errored' | 'cancelled';
export interface JobRecord {
    alias: string;
    sessionId: string;
    parentSessionId: string;
    agent: string;
    label: string;
    status: TaskStatus;
    background: boolean;
    terminalReconciled: boolean;
    createdAt: number;
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
//# sourceMappingURL=types.d.ts.map