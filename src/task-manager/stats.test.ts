// src/task-manager/stats.test.ts
// 验证 T9 性能指标统计：滑动窗口聚合、成功率/延迟/token 均值、分组
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { computeStats, defaultStrategyFor, type StatsRecord } from './tracker';

const rec = (over: Partial<StatsRecord> & Pick<StatsRecord, 'status'>): StatsRecord => ({
  agent: 'co-fixer',
  strategy: 'relevant',
  ...over,
});

describe('computeStats', () => {
  test('空记录 → 空数组', () => {
    expect(computeStats([])).toEqual([]);
  });

  test('同一 (strategy, agent)：成功率 = completed / count', () => {
    const r = computeStats([
      rec({ status: 'completed' }),
      rec({ status: 'completed' }),
      rec({ status: 'errored' }),
      rec({ status: 'cancelled' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].count).toBe(4);
    expect(r[0].successCount).toBe(2);
    expect(r[0].successRate).toBe(50);
  });

  test('平均延迟只统计有 latencyMs 的样本', () => {
    const r = computeStats([
      rec({ status: 'completed', latencyMs: 100 }),
      rec({ status: 'completed', latencyMs: 300 }),
      rec({ status: 'errored' }),
    ]);
    expect(r[0].latencySamples).toBe(2);
    expect(r[0].avgLatencyMs).toBe(200);
  });

  test('平均 token 为 input+output 总和，缺 tokens 样本跳过', () => {
    const r = computeStats([
      rec({ status: 'completed', tokens: { input: 100, output: 50 } }),
      rec({ status: 'completed', tokens: { input: 300, output: 150 } }),
      rec({ status: 'errored' }),
    ]);
    expect(r[0].tokenSamples).toBe(2);
    expect(r[0].avgTokens).toBe(300); // (150 + 450) / 2
  });

  test('滑动窗口：只统计最近 N 条', () => {
    const records = Array.from({ length: 10 }, (_, i) => rec({ status: i % 2 === 0 ? 'completed' : 'errored' }));
    const r = computeStats(records, 4);
    expect(r[0].count).toBe(4);
    // 最近 4 条（索引 6-9）：completed(6) errored(7) completed(8) errored(9)
    expect(r[0].successCount).toBe(2);
  });

  test('按 (strategy, agent) 分组并排序', () => {
    const r = computeStats([
      rec({ strategy: 'none', agent: 'co-explorer', status: 'completed' }),
      rec({ strategy: 'relevant', agent: 'co-fixer', status: 'completed' }),
      rec({ strategy: 'relevant', agent: 'co-fixer', status: 'errored' }),
      rec({ strategy: 'summary', agent: 'co-oracle', status: 'completed' }),
    ]);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ strategy: 'none', agent: 'co-explorer', count: 1, successRate: 100 });
    expect(r[1]).toMatchObject({ strategy: 'relevant', agent: 'co-fixer', count: 2, successRate: 50 });
    expect(r[2]).toMatchObject({ strategy: 'summary', agent: 'co-oracle', count: 1, successRate: 100 });
  });
});

describe('defaultStrategyFor', () => {
  test('已知代理返回默认策略', () => {
    expect(defaultStrategyFor('co-fixer')).toBe('relevant');
    expect(defaultStrategyFor('co-oracle')).toBe('summary');
    expect(defaultStrategyFor('co-explorer')).toBe('none');
  });

  test('未知代理 → none', () => {
    expect(defaultStrategyFor('custom-agent')).toBe('none');
  });
});
