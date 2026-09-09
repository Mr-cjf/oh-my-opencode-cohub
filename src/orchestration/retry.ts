// src/orchestration/retry.ts
import type { OrchestrationTask, RetryPolicy } from './types';
import { DEFAULT_RETRY_POLICIES } from './types';

export type RetryDecision = 'retry' | 'fallback' | 'abort';

export class RetryManager {
  private policies: Record<string, RetryPolicy>;
  private failureStats = new Map<string, { count: number; triedFallbacks: string[] }>();

  constructor(overrides?: Record<string, RetryPolicy>) {
    this.policies = { ...DEFAULT_RETRY_POLICIES, ...overrides };
  }

  getPolicy(agent: string): RetryPolicy {
    return this.policies[agent] ?? this.policies['__default__']!;
  }

  decide(task: OrchestrationTask, error: string): RetryDecision {
    const policy = this.getPolicy(task.agent);

    // 1. 检查不可重试错误
    if (policy.nonRetryableErrors.some(e => error.toLowerCase().includes(e))) {
      return 'abort';
    }

    // 2. 检查是否可重试 — 如果不匹配 retryableErrors，则不可重试
    const isRetryable = policy.retryableErrors.some(e => error.toLowerCase().includes(e));
    if (!isRetryable) return 'abort';

    // 3. 检查重试次数
    if (task.retryCount >= policy.maxRetries) {
      if (policy.fallbackAgents?.length) return 'fallback';
      return 'abort';
    }

    return 'retry';
  }

  getBackoffMs(task: OrchestrationTask, type: RetryPolicy['backoff'], baseMs: number): number {
    switch (type) {
      case 'exponential': return baseMs * Math.pow(2, task.retryCount);
      case 'fixed': return baseMs;
      case 'immediate': return 0;
    }
  }

  recordFailure(agent: string, _error: string): void {
    const stats = this.failureStats.get(agent) ?? { count: 0, triedFallbacks: [] };
    stats.count++;
    this.failureStats.set(agent, stats);
  }

  recordFallbackUsed(agent: string, fallback: string): void {
    const stats = this.failureStats.get(agent) ?? { count: 0, triedFallbacks: [] };
    stats.triedFallbacks.push(fallback);
    this.failureStats.set(agent, stats);
  }

  getFallbackAgent(agent: string): string | undefined {
    const policy = this.getPolicy(agent);
    const used = this.failureStats.get(agent)?.triedFallbacks ?? [];
    return policy.fallbackAgents?.find(a => !used.includes(a));
  }
}