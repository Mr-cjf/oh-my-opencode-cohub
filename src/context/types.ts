// src/context/types.ts — 上下文共享系统所有类型定义

/** 上下文注入策略 */
export type ContextStrategy = 'none' | 'relevant' | 'summary' | 'full';

/** 任务相关文件描述 */
export interface RelevantFile {
  path: string;
  lines?: string;       // 如 "42-87"
  summary: string;       // 一句话说明该文件与任务的关系
}

/** 前置子代理的完成结果 */
export interface DependencyResult {
  alias: string;         // 如 "exp-1"
  agent: string;         // 如 "co-explorer"
  keyOutput: string;     // 子代理结果中的关键信息
  capturedAt: number;    // Date.now()
}

/** 注入到子代理的结构化上下文 */
export interface TaskContext {
  goal: string;                        // 任务目标
  relevantFiles: RelevantFile[];       // 相关文件列表
  decisions: string[];                 // 父 session 中做出的关键决策
  errors: string[];                    // 需要修复的错误信息
  dependencies: DependencyResult[];    // 前置子代理的完成结果
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
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  strategy: {
    'co-explorer': 'none',
    'co-librarian': 'none',
    'co-observer': 'none',
    'co-fixer': 'relevant',
    'co-designer': 'relevant',
    'co-planner': 'relevant',
    'co-oracle': 'summary',
    'co-council': 'summary',
    'co-rule-user': 'none',
    'co-rule-project': 'none',
    'co-rule-app': 'none',
  },
  maxFiles: 5,
  maxDecisions: 10,
  maxErrors: 5,
  maxDependencies: 8,
  dependencyPropagation: true,
  summarizeMaxTokens: 2000,
  relevantMessageWindow: 20,
};
