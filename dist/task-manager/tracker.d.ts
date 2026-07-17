import type { TaskStatus, TaskArgs } from './types';
export declare class TaskTracker {
    private jobs;
    private counters;
    /** 最近一次 tool hook 收到的 parentSessionId */
    private _currentParentSessionId;
    /** 已 reconcile 的父 session ID，避免同一轮重复 reconcile */
    private _reconciledForParent;
    get currentParentSessionId(): string;
    /** 生成代理别名，如 fixer → "fix-1", explorer → "exp-2" */
    private alias;
    /**
     * 在 tool.execute.before 中调用，注册即将执行的任务
     */
    registerBeforeTask(parentSessionId: string, args: TaskArgs): string;
    /**
     * 在 tool.execute.after 中调用，更新任务完成状态
     * 非背景任务：立即标 completed；背景任务：不更新（等 session.idle 事件）
     */
    updateAfterTask(parentSessionId: string, status: TaskStatus, sessionId?: string): void;
    /**
     * 根据子 session ID 更新任务状态（供 event hook 使用）
     * 当背景任务的 session 变为 idle 时调用
     */
    updateByChildSessionId(sessionId: string, status: TaskStatus): void;
    /**
     * 生成 Background Job Board 文本
     */
    getBoardText(parentSessionId?: string): string | null;
    /**
     * 标记任务已调和（不再显示在 Unreconciled 中）
     */
    reconcileJob(alias: string): void;
    /**
     * 清理超时的背景任务（超过 timeoutMs 仍 running 的标为 errored）
     */
    cleanupStaleJobs(timeoutMs: number): void;
    /**
     * 检查任务是否可复用
     */
    isReusable(alias: string): boolean;
    /** 获取所有正在运行的 agent 类型列表 */
    getRunningAgents(parentSessionId: string): string[];
    /** 获取父会话下所有运行中的任务数量 */
    getRunningCount(parentSessionId: string): number;
    /** 根据子 session ID 查找 JobRecord */
    getJobBySessionId(sessionId: string): {
        alias: string;
        agent: string;
    } | undefined;
    /** cancel_task 集成：根据别名或 sessionId 标记任务为已取消并 reconcile */
    markCancelled(taskId: string): void;
}
//# sourceMappingURL=tracker.d.ts.map