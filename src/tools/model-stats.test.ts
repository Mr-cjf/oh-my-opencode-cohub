// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供（对齐 council.test.ts 写法）
// src/tools/model-stats.test.ts
import { describe, expect, test, beforeEach } from 'bun:test';
import {
  DEFAULT_MODEL_STATS_CONFIG,
  configureModelStats,
  getModelStats,
  getSortedModels,
  orderCouncillorsByFailure,
  recordModelResult,
  resetModelStats,
} from './model-stats';
import type { ModelStats } from './model-stats';

beforeEach(() => {
  resetModelStats();
  configureModelStats(DEFAULT_MODEL_STATS_CONFIG);
});

/** 构造一个带指定失败率的假统计快照（供排序/软剔除测试注入） */
function fakeStats(model: string, total: number, failures: number): ModelStats {
  return {
    model,
    total,
    successes: total - failures,
    failures,
    empty: 0,
    timeout: 0,
    error: 0,
    qualityLow: 0,
    failureRate: total === 0 ? 0 : failures / total,
    successRate: total === 0 ? 1 : (total - failures) / total,
  };
}

const entry = (name: string, model: string): [string, { model: string }] => [name, { model }];

describe('recordModelResult / getModelStats (T7 统计回写与查询)', () => {
  test('记录成功与各类失败并推导成功率/失败率', () => {
    recordModelResult('openai/gpt-4', 'success');
    recordModelResult('openai/gpt-4', 'success');
    recordModelResult('openai/gpt-4', 'timeout');
    recordModelResult('openai/gpt-4', 'empty');
    const s = getModelStats('openai/gpt-4');
    expect(s.total).toBe(4);
    expect(s.successes).toBe(2);
    expect(s.failures).toBe(2);
    expect(s.timeout).toBe(1);
    expect(s.empty).toBe(1);
    expect(s.error).toBe(0);
    expect(s.qualityLow).toBe(0);
    expect(s.failureRate).toBeCloseTo(0.5);
    expect(s.successRate).toBeCloseTo(0.5);
  });

  test('quality-low 计入失败', () => {
    recordModelResult('m', 'quality-low');
    const s = getModelStats('m');
    expect(s.qualityLow).toBe(1);
    expect(s.failures).toBe(1);
    expect(s.failureRate).toBe(1);
  });

  test('未知模型返回全零快照（failureRate=0, successRate=1 默认信任）', () => {
    const s = getModelStats('openai/unknown');
    expect(s.total).toBe(0);
    expect(s.failures).toBe(0);
    expect(s.failureRate).toBe(0);
    expect(s.successRate).toBe(1);
  });

  test('滑动窗口裁剪最旧记录', () => {
    configureModelStats({ windowSize: 3 });
    for (let i = 0; i < 5; i++) recordModelResult('m', 'success');
    recordModelResult('m', 'error');
    const s = getModelStats('m');
    expect(s.total).toBe(3);
    expect(s.successes).toBe(2);
    expect(s.failures).toBe(1);
  });

  test('resetModelStats 清空全部历史', () => {
    recordModelResult('a', 'error');
    resetModelStats();
    expect(getModelStats('a').total).toBe(0);
  });
});

describe('getSortedModels (T7 失败率升序)', () => {
  test('按失败率升序返回', () => {
    recordModelResult('good', 'success');
    recordModelResult('good', 'success');
    recordModelResult('mid', 'error');
    recordModelResult('bad', 'timeout');
    recordModelResult('bad', 'timeout');
    const sorted = getSortedModels();
    expect(sorted.map((x) => x.model)).toEqual(['good', 'mid', 'bad']);
    expect(sorted[0].stats.failureRate).toBeLessThanOrEqual(sorted[1].stats.failureRate);
    expect(sorted[1].stats.failureRate).toBeLessThanOrEqual(sorted[2].stats.failureRate);
  });
});

describe('orderCouncillorsByFailure (T7 前馈降级选择)', () => {
  test('失败率低的模型排在前面（两个模型均未达剔除线）', () => {
    const provider = (m: string) => fakeStats(m, 10, m === 'worse' ? 4 : 1);
    const entries = [entry('c1', 'worse'), entry('c2', 'better')];
    const sorted = orderCouncillorsByFailure(entries, provider);
    expect(sorted[0][1].model).toBe('better');
    expect(sorted[1][1].model).toBe('worse');
  });

  test('失败率 >50% 且样本 ≥5 的模型在有替代时被跳过', () => {
    const provider = (m: string) =>
      m === 'bad' ? fakeStats('bad', 10, 8) : fakeStats('good', 8, 1);
    const entries = [entry('c1', 'bad'), entry('c2', 'good')];
    const chosen = orderCouncillorsByFailure(entries, provider);
    expect(chosen.map(([, c]) => c.model)).toEqual(['good']);
  });

  test('全部为高风险（无替代）时回退完整列表，不硬剔除', () => {
    const provider = (m: string) => fakeStats(m, 10, 9);
    const entries = [entry('a', 'm1'), entry('b', 'm2')];
    const chosen = orderCouncillorsByFailure(entries, provider);
    expect(chosen.length).toBe(2);
  });

  test('样本数不足 minSamples 时不剔除', () => {
    const provider = (m: string) => fakeStats(m, 2, 2); // 失败率 100% 但只有 2 个样本
    const entries = [entry('a', 'm1'), entry('b', 'm2')];
    const chosen = orderCouncillorsByFailure(entries, provider);
    expect(chosen.length).toBe(2);
  });

  test('无历史（total=0）的模型默认信任，排在失败模型之前', () => {
    const provider = (m: string) => (m === 'bad' ? fakeStats('bad', 10, 4) : fakeStats('new', 0, 0));
    const entries = [entry('c1', 'bad'), entry('c2', 'new')];
    const sorted = orderCouncillorsByFailure(entries, provider);
    expect(sorted[0][1].model).toBe('new');
    expect(sorted[1][1].model).toBe('bad');
  });

  test('默认使用模块级存储：注入真实记录后排序生效', () => {
    recordModelResult('healthy', 'success');
    recordModelResult('healthy', 'success');
    for (let i = 0; i < 6; i++) recordModelResult('sick', 'error');
    const entries = [entry('c1', 'sick'), entry('c2', 'healthy')];
    const chosen = orderCouncillorsByFailure(entries);
    expect(chosen.map(([, c]) => c.model)).toEqual(['healthy']);
  });
});
