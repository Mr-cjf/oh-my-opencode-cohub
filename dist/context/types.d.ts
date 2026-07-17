/** 上下文注入策略 */
export type ContextStrategy = 'none' | 'relevant' | 'summary' | 'full';
/** 任务相关文件描述 */
export interface RelevantFile {
    path: string;
    lines?: string;
    summary: string;
}
/** 前置子代理的完成结果 */
export interface DependencyResult {
    alias: string;
    agent: string;
    keyOutput: string;
    capturedAt: number;
}
/** 注入到子代理的结构化上下文 */
export interface TaskContext {
    goal: string;
    relevantFiles: RelevantFile[];
    decisions: string[];
    errors: string[];
    dependencies: DependencyResult[];
}
/** 上下文系统配置 */
export interface ContextConfig {
    /** 各代理的默认上下文策略 */
    strategy: Record<string, ContextStrategy>;
    /** 最多注入多少个相关文件 */
    maxFiles: number;
    /** 最多注入多少条决策 */
    maxDecisions: number;
    /** 最多注入多少条错误 */
    maxErrors: number;
    /** 最多注入多少条依赖结果 */
    maxDependencies: number;
    /** 是否启用依赖传播（子代理结果自动注入到后续子代理） */
    dependencyPropagation: boolean;
    /** LLM 摘要最大 token 数 */
    summarizeMaxTokens: number;
    /** 从父 session 中扫描最近多少条消息 */
    relevantMessageWindow: number;
}
/** 默认配置 */
export declare const DEFAULT_CONTEXT_CONFIG: ContextConfig;
//# sourceMappingURL=types.d.ts.map