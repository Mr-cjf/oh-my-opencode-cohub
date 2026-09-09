// src/orchestration/engine.test.ts
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供
import { describe, it, expect, beforeEach } from 'bun:test';
import { OrchestrationEngine } from './engine';
import { ContractManager } from './contract';
import { RetryManager } from './retry';

describe('OrchestrationEngine', () => {
  let engine: OrchestrationEngine;

  beforeEach(() => {
    engine = new OrchestrationEngine(new ContractManager(), new RetryManager());
  });

  it('should register a task with no deps as ready', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    expect(engine.getState('t1')).toBe('ready');
  });

  it('should register a task with deps as pending', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-fixer', '实现', ['t1']);
    expect(engine.getState('t2')).toBe('pending');
  });

  it('should transition pending to ready when dep completes', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-fixer', '实现', ['t1']);
    engine.transition('t1', 'running');
    engine.transition('t1', 'completed');
    expect(engine.getState('t2')).toBe('ready');
  });

  it('should reject invalid transitions', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    expect(() => engine.transition('t1', 'failed')).toThrow();
  });

  it('should cascade cancel dependents', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-fixer', '实现', ['t1']);
    engine.registerTask('t3', 'co-oracle', '审查', ['t2']);
    engine.transition('t1', 'cancelled');
    expect(engine.getState('t1')).toBe('cancelled');
    expect(engine.getState('t2')).toBe('cancelled');
    expect(engine.getState('t3')).toBe('cancelled');
  });

  it('should get ready tasks sorted by depth', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-explorer', '搜索2');
    engine.registerTask('t3', 'co-fixer', '实现', ['t1', 't2']);
    const ready = engine.getReadyTasks();
    expect(ready).toContain('t1');
    expect(ready).toContain('t2');
    expect(ready).not.toContain('t3');
  });

  it('should handle retry transition: failed → pending', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.transition('t1', 'running');
    engine.transition('t1', 'failed');
    engine.transition('t1', 'pending');  // 重试
    expect(engine.getState('t1')).toBe('pending');
  });

  it('should get DAG summary string', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-fixer', '实现', ['t1']);
    engine.transition('t1', 'running');
    engine.transition('t1', 'completed');
    const summary = engine.getDAGSummary();
    expect(summary).toContain('t1');
    expect(summary).toContain('t2');
    expect(summary).toContain('completed');
    expect(summary).toContain('ready');
  });
});