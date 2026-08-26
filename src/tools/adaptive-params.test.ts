// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供（对齐 council.test.ts 写法）
// src/tools/adaptive-params.test.ts
import { describe, expect, test, beforeEach } from 'bun:test';
import {
  DEFAULT_ADAPTIVE_CONFIG,
  adjustAdaptiveParams,
  clampAdaptiveParams,
  configureAdaptiveParams,
  evaluateAdjustment,
  getAdaptiveParams,
  recordAdaptiveSample,
  resetAdaptiveParams,
} from './adaptive-params';

const KEY = 'default\u0000openai/gpt-4';

beforeEach(() => {
  resetAdaptiveParams();
  configureAdaptiveParams(DEFAULT_ADAPTIVE_CONFIG);
});

describe('evaluateAdjustment (T8 方向判定)', () => {
  test('成功率 > 80% → 降参 (-1)', () => {
    expect(evaluateAdjustment(0.9, 5)).toBe(-1);
    expect(evaluateAdjustment(1, 5)).toBe(-1);
  });
  test('成功率 < 50% → 升参 (+1)', () => {
    expect(evaluateAdjustment(0.4, 5)).toBe(1);
    expect(evaluateAdjustment(0, 5)).toBe(1);
  });
  test('中间区间 → 不变 (0)', () => {
    expect(evaluateAdjustment(0.6, 5)).toBe(0);
    expect(evaluateAdjustment(0.5, 5)).toBe(0); // 恰等于 lowRate 不触发
    expect(evaluateAdjustment(0.8, 5)).toBe(0); // 恰等于 highRate 不触发
  });
  test('样本不足 → 用默认值 (0)', () => {
    expect(evaluateAdjustment(0, 4)).toBe(0);
    expect(evaluateAdjustment(1, 0)).toBe(0);
  });
});

describe('clampAdaptiveParams (T8 参数限幅)', () => {
  test('retries 限制在 1-5', () => {
    expect(clampAdaptiveParams({ retries: 0, timeoutMs: 180_000 }).retries).toBe(1);
    expect(clampAdaptiveParams({ retries: 9, timeoutMs: 180_000 }).retries).toBe(5);
    expect(clampAdaptiveParams({ retries: 3, timeoutMs: 180_000 }).retries).toBe(3);
  });
  test('timeout 限制在 60s-300s', () => {
    expect(clampAdaptiveParams({ retries: 3, timeoutMs: 10_000 }).timeoutMs).toBe(60_000);
    expect(clampAdaptiveParams({ retries: 3, timeoutMs: 600_000 }).timeoutMs).toBe(300_000);
    expect(clampAdaptiveParams({ retries: 3, timeoutMs: 180_000 }).timeoutMs).toBe(180_000);
  });
});

describe('adjustAdaptiveParams (T8 单步调整)', () => {
  test('降参：retries-1 且 timeout 降一档', () => {
    const p = adjustAdaptiveParams({ retries: 3, timeoutMs: 180_000 }, -1);
    expect(p.retries).toBe(2);
    expect(p.timeoutMs).toBe(150_000);
  });
  test('升参：retries+1 且 timeout 升一档', () => {
    const p = adjustAdaptiveParams({ retries: 3, timeoutMs: 180_000 }, 1);
    expect(p.retries).toBe(4);
    expect(p.timeoutMs).toBe(210_000);
  });
  test('direction 0 保持不变', () => {
    expect(adjustAdaptiveParams({ retries: 3, timeoutMs: 180_000 }, 0)).toEqual({
      retries: 3,
      timeoutMs: 180_000,
    });
  });
  test('调整后仍限幅', () => {
    expect(adjustAdaptiveParams({ retries: 1, timeoutMs: 60_000 }, -1)).toEqual({
      retries: 1,
      timeoutMs: 60_000,
    });
    expect(adjustAdaptiveParams({ retries: 5, timeoutMs: 300_000 }, 1)).toEqual({
      retries: 5,
      timeoutMs: 300_000,
    });
  });
});

describe('recordAdaptiveSample / getAdaptiveParams (T8 滞后与生效)', () => {
  test('无历史 → 默认值', () => {
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 3, timeoutMs: 180_000 });
  });

  test('低成功率：样本足够后连续 5 次同方向采样才生效', () => {
    for (let i = 0; i < 5; i++) recordAdaptiveSample(KEY, false);
    // 样本刚达到 minSamples=5，方向 +1 但 streak 仅 1，未达滞后窗口
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 3, timeoutMs: 180_000 });
    for (let i = 0; i < 4; i++) recordAdaptiveSample(KEY, false);
    // 连续 5 次 +1（第 5~9 次采样）→ 生效升参
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 4, timeoutMs: 210_000 });
  });

  test('高成功率：样本足够后连续 5 次同方向采样才生效', () => {
    for (let i = 0; i < 9; i++) recordAdaptiveSample(KEY, true);
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 2, timeoutMs: 150_000 });
  });

  test('样本不足（< minSamples）不调整', () => {
    for (let i = 0; i < 4; i++) recordAdaptiveSample(KEY, false);
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 3, timeoutMs: 180_000 });
  });

  test('生效后计数清零，需重新连续采样才能再调一档（minSamples=1 每次判定）', () => {
    configureAdaptiveParams({ minSamples: 1, hysteresisSamples: 2 });
    recordAdaptiveSample(KEY, false); // +1, streak 1
    recordAdaptiveSample(KEY, false); // +1, streak 2 → 生效 retries=4
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 4, timeoutMs: 210_000 });
    recordAdaptiveSample(KEY, false); // +1, streak 1（重新累计）
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 4, timeoutMs: 210_000 });
    recordAdaptiveSample(KEY, false); // +1, streak 2 → 生效 retries=5
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 5, timeoutMs: 240_000 });
  });

  test('方向反转重置滞后计数，推迟生效', () => {
    // minSamples=1 每次采样都判定；hysteresisSamples=4
    configureAdaptiveParams({ minSamples: 1, hysteresisSamples: 4 });
    recordAdaptiveSample(KEY, false); // rate 0 → +1, streak 1
    recordAdaptiveSample(KEY, false); // rate 0 → +1, streak 2
    recordAdaptiveSample(KEY, true);  // rate 0.333 → +1（仍低），streak 3
    recordAdaptiveSample(KEY, true);  // rate 0.5 → 0（方向变化），streak 重置为 1
    recordAdaptiveSample(KEY, false); // rate 0.4 → +1（方向变化），streak 重置为 1
    // 无重置逻辑时此处 streak 已达 4+ 早已生效；有重置则仍为默认
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 3, timeoutMs: 180_000 });
    recordAdaptiveSample(KEY, false); // +1, streak 2
    recordAdaptiveSample(KEY, false); // +1, streak 3
    recordAdaptiveSample(KEY, false); // +1, streak 4 → 生效
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 4, timeoutMs: 210_000 });
  });

  test('key 按 (strategy, agent) 隔离', () => {
    const keyA = 'high\u0000openai/gpt-4';
    const keyB = 'low\u0000openai/gpt-4';
    for (let i = 0; i < 9; i++) recordAdaptiveSample(keyA, true); // 高成功率 → 降参
    for (let i = 0; i < 9; i++) recordAdaptiveSample(keyB, false); // 低成功率 → 升参
    expect(getAdaptiveParams(keyA)).toEqual({ retries: 2, timeoutMs: 150_000 });
    expect(getAdaptiveParams(keyB)).toEqual({ retries: 4, timeoutMs: 210_000 });
  });

  test('自定义默认值（注入 cfg.defaultRetries/defaultTimeoutMs）', () => {
    const cfg = { ...DEFAULT_ADAPTIVE_CONFIG, defaultRetries: 2, defaultTimeoutMs: 120_000 };
    expect(getAdaptiveParams('k', cfg)).toEqual({ retries: 2, timeoutMs: 120_000 });
    for (let i = 0; i < 9; i++) recordAdaptiveSample('k', false, cfg);
    expect(getAdaptiveParams('k', cfg)).toEqual({ retries: 3, timeoutMs: 150_000 });
  });

  test('滑动窗口裁剪最旧样本', () => {
    configureAdaptiveParams({ windowSize: 4, minSamples: 4, hysteresisSamples: 1 });
    // 前 4 条：3 失败 1 成功 → rate 0.25 → +1，生效 retries=4
    recordAdaptiveSample(KEY, false);
    recordAdaptiveSample(KEY, false);
    recordAdaptiveSample(KEY, false);
    recordAdaptiveSample(KEY, true);
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 4, timeoutMs: 210_000 });
    // 窗口滑出 3 条失败，仅剩 1 成功 + 3 成功 → rate 1 → -1，生效 retries=3
    recordAdaptiveSample(KEY, true);
    recordAdaptiveSample(KEY, true);
    recordAdaptiveSample(KEY, true);
    expect(getAdaptiveParams(KEY)).toEqual({ retries: 3, timeoutMs: 180_000 });
  });
});
