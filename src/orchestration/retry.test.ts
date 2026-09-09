// src/orchestration/retry.test.ts
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供
import { describe, it, expect } from 'bun:test';
import { RetryManager } from './retry';
import type { OrchestrationTask } from './types';

function makeTask(overrides: Partial<OrchestrationTask> = {}): OrchestrationTask {
  return {
    alias: 'test-1', agent: 'co-explorer', label: '测试',
    state: 'failed', deps: [], dependents: [],
    retryCount: 0, maxRetries: 2, createdAt: Date.now(),
    ...overrides,
  };
}

describe('RetryManager', () => {
  it('should retry when error is retryable and retries remain', () => {
    const mgr = new RetryManager();
    const task = makeTask({ retryCount: 0, maxRetries: 2 });
    expect(mgr.decide(task, 'rate limit exceeded')).toBe('retry');
  });

  it('should abort when error is non-retryable', () => {
    const mgr = new RetryManager();
    const task = makeTask();
    expect(mgr.decide(task, 'not found: file missing')).toBe('abort');
  });

  it('should abort when retries exhausted', () => {
    const mgr = new RetryManager();
    const task = makeTask({ retryCount: 2, maxRetries: 2 });
    expect(mgr.decide(task, 'timeout')).toBe('abort');
  });

  it('should fallback when retries exhausted and fallback agents exist', () => {
    const mgr = new RetryManager({
      'co-fixer': { maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
        retryableErrors: ['timeout'], nonRetryableErrors: [],
        fallbackAgents: ['co-oracle'] },
    });
    const task = makeTask({ agent: 'co-fixer', retryCount: 1, maxRetries: 1 });
    expect(mgr.decide(task, 'timeout')).toBe('fallback');
  });

  it('should use exponential backoff', () => {
    const mgr = new RetryManager();
    expect(mgr.getBackoffMs(makeTask({ retryCount: 0 }), 'exponential', 2000)).toBe(2000);
    expect(mgr.getBackoffMs(makeTask({ retryCount: 1 }), 'exponential', 2000)).toBe(4000);
    expect(mgr.getBackoffMs(makeTask({ retryCount: 2 }), 'exponential', 2000)).toBe(8000);
  });

  it('should use fixed backoff', () => {
    const mgr = new RetryManager();
    expect(mgr.getBackoffMs(makeTask({ retryCount: 0 }), 'fixed', 1000)).toBe(1000);
    expect(mgr.getBackoffMs(makeTask({ retryCount: 3 }), 'fixed', 1000)).toBe(1000);
  });

  it('should track and retrieve fallback agent', () => {
    const mgr = new RetryManager({
      'co-fixer': { maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
        retryableErrors: ['timeout'], nonRetryableErrors: [],
        fallbackAgents: ['co-oracle', 'co-designer'] },
    });
    const task = makeTask({ agent: 'co-fixer', retryCount: 1, maxRetries: 1 });
    mgr.recordFailure('co-fixer', 'timeout');
    expect(mgr.getFallbackAgent('co-fixer')).toBe('co-oracle');
    mgr.recordFallbackUsed('co-fixer', 'co-oracle');
    expect(mgr.getFallbackAgent('co-fixer')).toBe('co-designer');
  });

  it('should reject non-retryable errors immediately', () => {
    const mgr = new RetryManager();
    const task = makeTask({ retryCount: 0, maxRetries: 5 });
    expect(mgr.decide(task, 'permission denied')).toBe('abort');
  });
});