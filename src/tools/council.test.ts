// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供（对齐 extractor.test.ts 写法）
// src/tools/council.test.ts
import { describe, expect, test, beforeEach } from 'bun:test';
import {
  appendRetryContext,
  classifyFailure,
  computeConsensus,
  decideRetryAction,
  downgradeVariant,
  extractCouncillorSummary,
  pairwiseAgreement,
  RetryBudget,
  CouncilManager,
} from './council';
import { resetModelStats } from './model-stats';
import { resetAdaptiveParams } from './adaptive-params';

describe('classifyFailure (T2 decision table mapping)', () => {
  test('empty response -> empty', () => {
    expect(classifyFailure('[oh-my-opencode-cohub] Empty response from provider')).toBe('empty');
  });
  test('timeout -> timeout', () => {
    expect(classifyFailure('[oh-my-opencode-cohub] Prompt timed out after 180000ms')).toBe('timeout');
    expect(classifyFailure('OperationTimeoutError: boom')).toBe('timeout');
  });
  test('other errors -> error', () => {
    expect(classifyFailure('Failed to create session')).toBe('error');
  });
});

describe('extractCouncillorSummary (T3 structured summary)', () => {
  test('extracts conclusion and entity sentences', () => {
    const text = [
      '我们分析了三个方案。',
      '结论：采用方案 B，成本最低。',
      '关键决策：方案 B、迁移周期 2 周。',
      '其他细节略。',
    ].join('\n');
    const s = extractCouncillorSummary(text);
    expect(s.conclusions.length).toBeGreaterThan(0);
    expect(s.conclusions[0]).toContain('结论');
    expect(s.entities.length).toBeGreaterThan(0);
  });
  test('falls back to the last sentence when no conclusion marker', () => {
    const s = extractCouncillorSummary('第一句。第二句。');
    expect(s.conclusions).toEqual(['第二句。']);
  });
  test('empty text -> empty summary', () => {
    expect(extractCouncillorSummary('')).toEqual({ conclusions: [], entities: [] });
  });
});

describe('pairwiseAgreement (T3 overlap)', () => {
  test('identical summaries agree fully', () => {
    const a = { conclusions: ['采用方案 B'], entities: ['方案 B', '迁移 2 周'] };
    expect(pairwiseAgreement(a, a)).toBeCloseTo(1);
  });
  test('disjoint summaries agree on zero', () => {
    const a = { conclusions: ['采用方案 B'], entities: ['方案 B'] };
    const b = { conclusions: ['reject'], entities: ['nothing'] };
    expect(pairwiseAgreement(a, b)).toBe(0);
  });
  test('empty summaries have zero agreement', () => {
    expect(
      pairwiseAgreement({ conclusions: [], entities: [] }, { conclusions: ['x'], entities: ['y'] }),
    ).toBe(0);
  });
});

describe('computeConsensus (T3 convergence)', () => {
  const mk = (name: string, tag: string) => ({
    name,
    summary: { conclusions: [`结论：${tag}`], entities: [tag] },
  });
  test('2/3 majority -> consensus', () => {
    const inputs = [mk('a', '方案B'), mk('b', '方案B'), mk('c', '方案A')];
    const r = computeConsensus(inputs, 0.5);
    expect(r.consensus).toBe(true);
  });
  test('split 1/3 -> no consensus', () => {
    const inputs = [mk('a', '方案B'), mk('b', '方案C'), mk('c', '方案A')];
    const r = computeConsensus(inputs, 0.5);
    expect(r.consensus).toBe(false);
  });
  test('P1-1 互斥方案不收敛（模板词剥离后 agreement 显著下降）', () => {
    // "结论：采用X方案" 高度模板化；剥离 结论/采用/方案 后只剩方案名，互斥时 agreement 应归零
    const inputs = [mk('a', '方案A'), mk('b', '方案B'), mk('c', '方案C')];
    const r = computeConsensus(inputs, 0.6);
    expect(r.consensus).toBe(false);
    expect(r.averageAgreement).toBeLessThan(0.6);
    expect(r.averageAgreement).toBe(0);
  });
  test('P1-1 默认阈值 0.6 下多数一致仍需更强收敛', () => {
    // 2/3 一致 + 1 反对：各自平均 pairwise 0.5 < 0.6，不算 consensus
    const inputs = [mk('a', '方案B'), mk('b', '方案B'), mk('c', '方案A')];
    const r = computeConsensus(inputs, 0.6);
    expect(r.consensus).toBe(false);
    // 显式放宽到 0.5 才收敛（保持旧行为可选）
    expect(computeConsensus(inputs, 0.5).consensus).toBe(true);
  });
  test('single councillor converges', () => {
    expect(computeConsensus([mk('a', 'x')], 0.5).consensus).toBe(true);
  });
  test('empty input never converges', () => {
    expect(computeConsensus([], 0.5).consensus).toBe(false);
  });
});

describe('decideRetryAction (T2 decision table)', () => {
  test('empty -> retry until limit', () => {
    expect(decideRetryAction('empty', 1, 0, true, 3)).toBe('retry');
  });
  test('timeout -> retry once, then give-up on second failure', () => {
    expect(decideRetryAction('timeout', 1, 0, true, 1)).toBe('retry');
    expect(decideRetryAction('timeout', 1, 1, true, 1)).toBe('give-up');
  });
  test('error -> never retries', () => {
    expect(decideRetryAction('error', 1, 0, true, 0)).toBe('give-up');
  });
  test('2 consecutive same-category failures -> needs-human', () => {
    expect(decideRetryAction('quality-low', 2, 1, true, 1)).toBe('needs-human');
    expect(decideRetryAction('empty', 2, 1, true, 3)).toBe('needs-human');
  });
  test('budget exhausted -> budget-exhausted', () => {
    expect(decideRetryAction('empty', 1, 0, false, 3)).toBe('budget-exhausted');
  });
});

describe('downgradeVariant (T2 timeout mitigation)', () => {
  test('steps down one level', () => {
    expect(downgradeVariant('max')).toBe('high');
    expect(downgradeVariant('high')).toBe('medium');
    expect(downgradeVariant('medium')).toBe('low');
    expect(downgradeVariant('low')).toBeUndefined();
  });
  test('undefined stays undefined', () => {
    expect(downgradeVariant(undefined)).toBeUndefined();
    expect(downgradeVariant('weird')).toBeUndefined();
  });
});

describe('appendRetryContext (T2 per-category retry prompt)', () => {
  test('timeout appends guidance', () => {
    expect(appendRetryContext('p', 'timeout')).toContain('[retry]');
  });
  test('quality-low appends decision guidance', () => {
    expect(appendRetryContext('p', 'quality-low')).toContain('结论');
  });
  test('empty/error keep the prompt unchanged', () => {
    expect(appendRetryContext('p', 'empty')).toBe('p');
    expect(appendRetryContext('p', 'error')).toBe('p');
  });
});

describe('RetryBudget (T4 budget counter)', () => {
  test('consumeRetry decrements until exhausted', () => {
    const b = new RetryBudget(2, Number.MAX_SAFE_INTEGER, Date.now());
    expect(b.retriesLeft).toBe(2);
    expect(b.consumeRetry()).toBe(true);
    expect(b.retriesLeft).toBe(1);
    expect(b.consumeRetry()).toBe(true);
    expect(b.consumeRetry()).toBe(false);
    expect(b.retriesLeft).toBe(0);
  });
  test('expired budget refuses consumption', () => {
    const expired = new RetryBudget(2, 100, Date.now() - 200);
    expect(expired.expired()).toBe(true);
    expect(expired.consumeRetry()).toBe(false);
  });
  test('elapsedMs reflects injected start time', () => {
    const b = new RetryBudget(2, 100, Date.now() - 50);
    expect(b.expired()).toBe(false);
  });
});


describe('CouncilManager 集成（P1-5 mock 控制路径）', () => {
  const preset = {
    c1: { model: 'provider/a' },
    c2: { model: 'provider/b' },
    c3: { model: 'provider/c' },
  };

  /** session 恒返回空响应，触发 "Empty response from provider" → empty 失败路径 */
  function makeEmptyMockClient() {
    const calls = { create: 0, prompt: 0, messages: 0, abort: 0 };
    const client = {
      session: {
        create: async () => {
          calls.create += 1;
          return { data: { id: 'mock-session' } };
        },
        prompt: async () => {
          calls.prompt += 1;
        },
        messages: async () => {
          calls.messages += 1;
          return { data: [] };
        },
        abort: async () => {
          calls.abort += 1;
        },
      },
    };
    return { client, calls };
  }

  beforeEach(() => {
    resetModelStats();
    resetAdaptiveParams();
  });

  test('parallel：empty 连续失败 + budget=2 时预算精确消耗并 budget-exhausted', async () => {
    const { client, calls } = makeEmptyMockClient();
    const manager = new CouncilManager(client, '/tmp', {
      presets: { default: preset },
      councillor_execution_mode: 'parallel',
      councillor_retries: 3,
      max_total_retries: 2,
    });
    const r = await manager.runCouncil('测试问题');
    expect(r.success).toBe(false);
    // 预算精确消耗 2：3 个 councillor 第 1 次尝试不耗（streak=1 → retry），
    // 其中恰好 2 个第 2 次各耗 1，第 3 个第 2 次因预算耗尽直接终止（不发 prompt）
    expect(calls.prompt).toBe(5);
    expect(calls.create).toBe(5);
    expect(calls.abort).toBe(5);
    // budget-exhausted 的 status 为 'error'、error 字段为 'budget-exhausted'
    const exhausted = r.councillorResults.filter((cr) => cr.error === 'budget-exhausted');
    expect(exhausted.length).toBeGreaterThanOrEqual(1);
    expect(r.councillorResults.some((cr) => cr.status === 'completed')).toBe(false);
    // 全部失败态（error / needs_human），无一成功
    for (const cr of r.councillorResults) {
      expect(['error', 'needs_human', 'failed', 'timed_out']).toContain(cr.status);
    }
  });

  test('serial：两轮 3 councillor、budget=6 时第二轮耗尽预算', async () => {
    const { client, calls } = makeEmptyMockClient();
    const manager = new CouncilManager(client, '/tmp', {
      presets: { default: preset },
      councillor_execution_mode: 'serial',
      max_rounds: 2,
      councillor_retries: 3,
      max_total_retries: 6,
    });
    const r = await manager.runCouncil('测试问题');
    expect(r.success).toBe(false);
    // round1: 每 councillor 第 1 次不耗 → retry，第 2 次耗 1 → needs-human（共耗 3，6 次 prompt）
    // round2: c1 耗 2（t1 耗 1 → retry，t2 耗 1 → needs-human），
    //         c2 耗 1（t1 耗 1 → retry，t2 预算耗尽 → budget-exhausted），
    //         c3 耗 0（t1 预算耗尽 → budget-exhausted）
    // 预算精确消耗 6，第二轮即耗尽（round2 共 3 次 prompt）
    expect(calls.prompt).toBe(9);
    expect(calls.create).toBe(9);
    expect(calls.abort).toBe(9);
    // 第二轮耗尽：round2 中 c2/c3 分别在第 2 次、第 1 次尝试时预算耗尽
    const exhausted = r.councillorResults.filter((cr) => cr.error === 'budget-exhausted');
    expect(exhausted.length).toBeGreaterThanOrEqual(1);
    expect(r.councillorResults.some((cr) => cr.status === 'needs_human')).toBe(true);
    expect(r.councillorResults.some((cr) => cr.status === 'completed')).toBe(false);
  });
});
