// src/context/engine.test.ts
// 验证 fillContextAsync 的 in-flight promise 去重行为
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { ContextEngine } from './engine';

// ---------------------------------------------------------------------------
// Helpers: mock 构造
// ---------------------------------------------------------------------------

/** 标准 mock：始终返回 1 个文件 + 1 个决策 + 0 个错误 */
function createMockClient() {
  let callCount = 0;
  const messages = async () => {
    await new Promise((r) => setTimeout(r, 5));  // 确保真实 yield，防止未来去掉 async 后静默失效
    callCount++;
    return {
      data: [
        {
          info: { role: 'assistant' },
          parts: [{ type: 'text', text: '我决定使用 TypeScript 严格模式' }],
        },
        {
          info: { role: 'assistant' },
          parts: [
            {
              type: 'tool',
              tool: 'read',
              state: {
                status: 'completed',
                input: { filePath: '/src/main.ts' },
                output: 'file content',
              },
            },
          ],
        },
      ],
    };
  };
  return {
    client: { session: { messages } },
    getCallCount: () => callCount,
  };
}

/** 第一次调用失败、后续成功的 mock */
function createFailingMock() {
  let callCount = 0;
  const messages = async () => {
    await new Promise((r) => setTimeout(r, 5));  // 确保真实 yield，防止未来去掉 async 后静默失效
    callCount++;
    if (callCount === 1) throw new Error('Network error');
    return {
      data: [
        {
          info: { role: 'assistant' },
          parts: [{ type: 'text', text: '我决定使用 Node.js' }],
        },
      ],
    };
  };
  return {
    client: { session: { messages } },
    getCallCount: () => callCount,
  };
}

/** 每次调用返回不同数据的 mock（批次计数器递增），用于验证跨批次不脏读 */
function createIncrementingMock() {
  let callCount = 0;
  let batchId = 0;
  const messages = async () => {
    await new Promise((r) => setTimeout(r, 5));  // 确保真实 yield
    callCount++;
    batchId++;
    return {
      data: [
        {
          info: { role: 'assistant' },
          parts: [{ type: 'text', text: `批次-${batchId} 的决策` }],
        },
        {
          info: { role: 'assistant' },
          parts: [
            {
              type: 'tool',
              tool: 'read',
              state: {
                status: 'completed',
                input: { filePath: `/src/main-v${batchId}.ts` },
                output: `批次-${batchId} — file content v${batchId}`,
              },
            },
          ],
        },
      ],
    };
  };
  return {
    client: { session: { messages } },
    getCallCount: () => callCount,
  };
}

// ===========================================================================
// fillContextAsync — in-flight promise 去重
// ===========================================================================
describe('fillContextAsync — in-flight promise 去重', () => {
  // ── 用例 1: 首次调用触发 API ────────────────────────────────────────
  test('首次调用会触发 client.session.messages', async () => {
    const { client, getCallCount } = createMockClient();
    const engine = new ContextEngine(client, {
      strategy: { 'test-agent': 'relevant' },
    });
    const ctxId = engine.registerContext({ description: 'test' });

    await engine.fillContextAsync(ctxId, 'ses_parent_1', {
      strategy: 'relevant',
    });

    expect(getCallCount()).toBe(1);
  });

  // ── 用例 2: 并发调用共享同一次 API ─────────────────────────────────
  test('并发调用（Promise.all）共享同一次 API 调用', async () => {
    const { client, getCallCount } = createMockClient();
    const engine = new ContextEngine(client, {
      strategy: { 'test-agent': 'relevant' },
    });
    const ctxId1 = engine.registerContext({ description: 'test1' });
    const ctxId2 = engine.registerContext({ description: 'test2' });

    await Promise.all([
      engine.fillContextAsync(ctxId1, 'ses_parent', { strategy: 'relevant' }),
      engine.fillContextAsync(ctxId2, 'ses_parent', { strategy: 'relevant' }),
    ]);

    // 两次并发 fill，但 API 只应调用 1 次（共享 inflight promise）
    expect(getCallCount()).toBe(1);
  });

  // ── 用例 3: 顺序第二次调用重新调 API（验证无脏读）─────────────────
  test('顺序的第二次调用（跨批次）重新调 API，无脏读', async () => {
    const { client, getCallCount } = createMockClient();
    const engine = new ContextEngine(client, {
      strategy: { 'test-agent': 'relevant' },
    });
    const ctxId1 = engine.registerContext({ description: 'test1' });
    const ctxId2 = engine.registerContext({ description: 'test2' });

    await engine.fillContextAsync(ctxId1, 'ses_parent', { strategy: 'relevant' });
    await engine.fillContextAsync(ctxId2, 'ses_parent', { strategy: 'relevant' });

    // 两次串行 fill，inflight 在第一次完成后已被删除，应当重新调 API
    expect(getCallCount()).toBe(2);
  });

  // ── 用例 4: 不同 parentSessionId 不共享 ────────────────────────────
  test('不同 parentSessionId 不共享 inflight', async () => {
    const { client, getCallCount } = createMockClient();
    const engine = new ContextEngine(client, {
      strategy: { 'test-agent': 'relevant' },
    });
    const ctxIdA = engine.registerContext({ description: 'A' });
    const ctxIdB = engine.registerContext({ description: 'B' });

    await engine.fillContextAsync(ctxIdA, 'ses_parent_a', { strategy: 'relevant' });
    await engine.fillContextAsync(ctxIdB, 'ses_parent_b', { strategy: 'relevant' });

    // 两个不同的 parentSessionId → 两次 API 调用
    expect(getCallCount()).toBe(2);
  });

  // ── 用例 5: 数据一致性 ─────────────────────────────────────────────
  test('返回的数据与 mock 内容相符', async () => {
    const { client } = createMockClient();
    const engine = new ContextEngine(client, {
      strategy: { 'test-agent': 'relevant' },
    });
    const ctxId = engine.registerContext({ description: 'test' });

    await engine.fillContextAsync(ctxId, 'ses_parent', { strategy: 'relevant' });

    const result = engine.formatContextDetails(ctxId);
    // 文件路径
    expect(result).toContain('/src/main.ts');
    // 决策内容
    expect(result).toContain('TypeScript 严格模式');
    // 不应有错误（mock 数据无错误）
    expect(result).not.toContain('近期错误');
  });

  // ── 用例 6: strategy='none' 不触发 API ─────────────────────────────
  test("strategy='none' 不会触发 API 调用", async () => {
    const { client, getCallCount } = createMockClient();
    const engine = new ContextEngine(client, {
      strategy: { 'test-agent': 'none' },
    });
    const ctxId = engine.registerContext({ description: 'test' });

    await engine.fillContextAsync(ctxId, 'ses_parent', { strategy: 'none' });

    expect(getCallCount()).toBe(0);
  });

  // ── 用例 7: 第一次调用失败后 inflight 被清理，后续能重试 ──────────
  test('第一次调用失败后 inflight 被清理，后续调用能重试', async () => {
    const { client, getCallCount } = createFailingMock();
    const engine = new ContextEngine(client, {
      strategy: { 'test-agent': 'relevant' },
    });
    const ctxId1 = engine.registerContext({ description: 'test1' });
    const ctxId2 = engine.registerContext({ description: 'test2' });

    // 第一次调用失败（被 catch 静默处理）
    await engine.fillContextAsync(ctxId1, 'ses_parent', { strategy: 'relevant' });
    // 第二次调用应触发新 API 调用（inflight 已被清理）
    await engine.fillContextAsync(ctxId2, 'ses_parent', { strategy: 'relevant' });

    // 第一次失败（1 次调用）+ 第二次重试（1 次调用）= 2
    expect(getCallCount()).toBe(2);
  });

  // ── 用例 8: 跨批次串行拿到最新数据（真正验证无脏读）─────────────────
  test('跨批次串行调用拿到最新数据，不返回旧缓存', async () => {
    const { client, getCallCount } = createIncrementingMock();
    const engine = new ContextEngine(client, {
      strategy: { 'test-agent': 'relevant' },
    });
    const ctxId1 = engine.registerContext({ description: 'batch1' });
    const ctxId2 = engine.registerContext({ description: 'batch2' });

    // 第一次调用 → 批次-1
    await engine.fillContextAsync(ctxId1, 'ses_parent', { strategy: 'relevant' });
    const result1 = engine.formatContextDetails(ctxId1);

    // 第二次串行调用（同一 parentSessionId）→ 应调 API 拿到新数据，不返回旧缓存
    await engine.fillContextAsync(ctxId2, 'ses_parent', { strategy: 'relevant' });
    const result2 = engine.formatContextDetails(ctxId2);

    expect(getCallCount()).toBe(2);

    // 第一次拿到批次-1 的数据
    expect(result1).toContain('批次-1');
    expect(result1).toContain('/src/main-v1.ts');
    // 第二次拿到批次-2 的数据（不是复用批次-1 的缓存）
    expect(result2).toContain('批次-2');
    expect(result2).toContain('/src/main-v2.ts');
    // 两次结果不同，真正证明跨批次不会脏读
    expect(result1).not.toBe(result2);
  });
});