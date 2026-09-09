// src/orchestration/scheduler.test.ts
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供
// TDD: Scheduler — 按 maxConcurrency + per-agent 限流调度

import { describe, it, expect, beforeEach } from 'bun:test';
import { Scheduler } from './scheduler';
import { OrchestrationEngine } from './engine';
import { ContractManager } from './contract';
import { RetryManager } from './retry';

describe('Scheduler', () => {
  let engine: OrchestrationEngine;
  let scheduler: Scheduler;

  beforeEach(() => {
    engine = new OrchestrationEngine(new ContractManager(), new RetryManager());
    scheduler = new Scheduler(engine, 3);  // maxConcurrency=3
  });

  it('should dispatch at most maxConcurrency tasks', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-explorer', '搜索2');
    engine.registerTask('t3', 'co-explorer', '搜索3');
    engine.registerTask('t4', 'co-explorer', '搜索4');
    const dispatched = scheduler.dispatch(0);
    expect(dispatched.length).toBe(3);
  });

  it('should not dispatch more than available slots', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-explorer', '搜索2');
    const d1 = scheduler.dispatch(0);
    expect(d1.length).toBe(2);
    const d2 = scheduler.dispatch(2);  // 2 正在运行，可用=1
    expect(d2.length).toBe(0);
  });

  it('should not dispatch a task that was already dispatched', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    const d1 = scheduler.dispatch(0);
    expect(d1).toContain('t1');
    const d2 = scheduler.dispatch(0);
    expect(d2).not.toContain('t1');
  });
});