// src/orchestration/types.ts
// Orchestration Engine 基础类型定义

import type { TaskStatus } from '../task-manager/types';

// ====== TaskState & OrchestrationTask ======

export type TaskState = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface OrchestrationTask {
  alias: string;
  agent: string;
  label: string;
  state: TaskState;
  deps: string[];          // 前置依赖 alias 列表
  dependents: string[];    // 后继任务 alias 列表（反向引用，用于级联取消）
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  timeoutMs?: number;
  result?: {
    summary: string;
    failedAgents?: string[];   // 已尝试过的代理类型（降级用）
    contract?: AgentContract;  // 任务完成后的结构化输出
  };
}

// ====== 状态转换 ======

// 合法状态转换表
export const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending:    ['ready', 'cancelled'],
  ready:      ['running', 'cancelled'],
  running:    ['completed', 'failed', 'cancelled'],
  failed:     ['pending', 'cancelled'],
  completed:  [],
  cancelled:  [],
};

/**
 * 校验状态转换是否合法，非法转换抛 Error
 */
export function validateTransition(from: TaskState, to: TaskState): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(
      `非法状态转换: ${from} -> ${to}，允许的目标状态: [${allowed.join(', ')}]`
    );
  }
}

// ====== RetryPolicy ======

export interface RetryPolicy {
  maxRetries: number;
  backoff: 'exponential' | 'fixed' | 'immediate';
  backoffMs: number;
  retryableErrors: string[];
  nonRetryableErrors: string[];
  fallbackAgents?: string[];
}

export const DEFAULT_RETRY_POLICIES: Record<string, RetryPolicy> = {
  'co-explorer': {
    maxRetries: 2, backoff: 'exponential', backoffMs: 2000,
    retryableErrors: ['rate limit', 'timeout', 'too many requests'],
    nonRetryableErrors: ['not found', 'permission'],
  },
  'co-fixer': {
    maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
    retryableErrors: ['timeout', 'build failed', 'test failed'],
    nonRetryableErrors: ['syntax error', 'invalid'],
  },
  'co-oracle': {
    maxRetries: 1, backoff: 'immediate', backoffMs: 0,
    retryableErrors: ['timeout'],
    nonRetryableErrors: [],
  },
  'co-librarian': {
    maxRetries: 2, backoff: 'exponential', backoffMs: 2000,
    retryableErrors: ['timeout', 'rate limit', 'fetch failed'],
    nonRetryableErrors: ['not found', 'invalid url'],
  },
  'co-council': {
    maxRetries: 2, backoff: 'exponential', backoffMs: 2000,
    retryableErrors: ['timeout', 'rate limit'],
    nonRetryableErrors: ['invalid api key'],
  },
  'co-designer': {
    maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
    retryableErrors: ['timeout'],
    nonRetryableErrors: ['syntax error'],
  },
  '__default__': {
    maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
    retryableErrors: ['timeout'],
    nonRetryableErrors: [],
  },
};

// ====== AgentContract ======

export interface AgentContract {
  keyResult: string;
  decisions: string[];
  filesChanged: string[];
  validationStatus: 'passed' | 'failed' | 'unknown';
  validationDetail?: string;
  pendingItems: string[];
  warnings: string[];
}

// ====== ConcurrencyConfig ======

export interface ConcurrencyConfig {
  maxConcurrency: number;
}

export const DEFAULT_CONCURRENCY: ConcurrencyConfig = {
  maxConcurrency: 20,  // 高上限，实际并行度由 DAG 依赖和 orchestrator 规则自然控制
};

// ====== OrchestrationConfig ======

export interface OrchestrationConfig {
  retryPolicies?: Record<string, RetryPolicy>;
  concurrency?: ConcurrencyConfig;
  defaultMaxRetries?: number;
}