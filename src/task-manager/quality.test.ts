// src/task-manager/quality.test.ts
// 验证质量判定器（P0-1 负反馈闭环）：评分、及格线、失败分类
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { assessQuality, hasErrorKeywords, isQualityEnabled, DEFAULT_QUALITY_CONFIG } from './quality';

describe('assessQuality', () => {
  test('全部合格：非空输出 + exit 0 + 无错误关键词 + decisions>=1 → score 1.0 且 passed', () => {
    const r = assessQuality({ output: '已完成修复并通过测试', exitCode: 0, decisions: 2 });
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
    expect(r.failureCategory).toBeUndefined();
  });

  test('空输出 → score 0, category empty', () => {
    const r = assessQuality({ output: '', exitCode: 0, decisions: 1 });
    expect(r.score).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.failureCategory).toBe('empty');
  });

  test('exit 非 0 → category error', () => {
    const r = assessQuality({ output: '构建输出', exitCode: 1, decisions: 1 });
    expect(r.passed).toBe(false);
    expect(r.failureCategory).toBe('error');
  });

  test('输出含中文错误关键词 → category error', () => {
    const r = assessQuality({ output: '任务失败：无法完成构建', decisions: 1 });
    expect(r.passed).toBe(false);
    expect(r.failureCategory).toBe('error');
  });

  test('英文 error 关键词大小写不敏感', () => {
    const r = assessQuality({ output: 'ERROR: build failed', decisions: 1 });
    expect(r.passed).toBe(false);
    expect(r.failureCategory).toBe('error');
  });

  test('decisions 为 0 且无其他失败 → category quality-low（仅标记）', () => {
    const r = assessQuality({ output: '正常输出，但无决策捕获', exitCode: 0, decisions: 0 });
    expect(r.passed).toBe(false);
    expect(r.failureCategory).toBe('quality-low');
  });

  test('timedOut → category timeout 且低分', () => {
    const r = assessQuality({ output: '部分输出', decisions: 1, timedOut: true });
    expect(r.passed).toBe(false);
    expect(r.failureCategory).toBe('timeout');
    expect(r.score).toBeLessThan(1);
  });

  test('latencyMs 与 tokens 透传', () => {
    const r = assessQuality({
      output: 'ok',
      decisions: 1,
      latencyMs: 1234,
      tokens: { input: 100, output: 50 },
    });
    expect(r.latencyMs).toBe(1234);
    expect(r.tokens).toEqual({ input: 100, output: 50 });
  });
});

describe('hasErrorKeywords', () => {
  test('命中中文关键词', () => {
    expect(hasErrorKeywords('任务失败')).toBe(true);
    expect(hasErrorKeywords('一切正常')).toBe(false);
  });

  test('命中英文关键词（大小写不敏感）', () => {
    expect(hasErrorKeywords('an Error occurred')).toBe(true);
    expect(hasErrorKeywords('all good')).toBe(false);
  });

  test('P1-3 否定式不误报', () => {
    expect(hasErrorKeywords('No errors found')).toBe(false);
    expect(hasErrorKeywords('没有发现错误，一切正常')).toBe(false);
    expect(hasErrorKeywords('构建未失败')).toBe(false);
    expect(hasErrorKeywords('without error')).toBe(false);
    expect(hasErrorKeywords('所有检查未发现异常')).toBe(false);
  });

  test('P1-3 代码片段不误报', () => {
    expect(hasErrorKeywords('console.error("x") 已注释')).toBe(false);
    expect(hasErrorKeywords('obj.failed 为 false')).toBe(false);
    expect(hasErrorKeywords('const err = new Error("boom")')).toBe(false);
  });

  test('P2-a 扩展否定式不误报（窗口 16 + 完整短语）', () => {
    expect(hasErrorKeywords('without any error')).toBe(false);
    expect(hasErrorKeywords('without any errors, all checks passed')).toBe(false);
    expect(hasErrorKeywords('未发现任何错误，流程正常')).toBe(false);
  });

  test('P2-a 真实负面表述仍命中（移除裸泛化词后不误剥）', () => {
    expect(hasErrorKeywords('没有修复错误，需要重试')).toBe(true);
    expect(hasErrorKeywords('未解决错误，继续排查')).toBe(true);
  });

  test('P1-3 真实错误仍命中', () => {
    expect(hasErrorKeywords('Error: build failed')).toBe(true);
    expect(hasErrorKeywords('任务失败：无法完成构建')).toBe(true);
    expect(hasErrorKeywords('构建失败，请检查')).toBe(true);
    expect(hasErrorKeywords('an exception was thrown')).toBe(true);
  });
});

describe('isQualityEnabled', () => {
  test('默认开启（无配置）', () => {
    expect(isQualityEnabled()).toBe(DEFAULT_QUALITY_CONFIG.enabled);
    expect(isQualityEnabled(undefined)).toBe(true);
  });

  test('显式关闭生效', () => {
    expect(isQualityEnabled({ enabled: false })).toBe(false);
  });
});
