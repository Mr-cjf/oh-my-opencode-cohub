// src/context/engine.test.ts
// 验证 ContextEngine 的 formatContextDetails 错误总量上限、captureResult 截断、
// 依赖结果渲染截断
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { ContextEngine } from './engine';
import { DEFAULT_CONTEXT_CONFIG } from './types';

// ===========================================================================
// Helper: 构造 mock SdkClient（仅用于构造 ContextEngine，不影响测试逻辑）
// ===========================================================================
function mockClient() {
  return {
    session: {
      messages: async () => ({ data: [] }),
    },
  } as never;
}

// ===========================================================================
// formatContextDetails — 错误总量上限
// ===========================================================================
describe('formatContextDetails 错误总量上限', () => {
  test('少量错误（≤600 字符）完整输出，无省略标记', () => {
    const engine = new ContextEngine(mockClient());
    const ctxId = engine.registerContext({ description: 'test' });
    // 手动填充 registry 中的 errors
    const ctx = (engine as never).registry.get(ctxId);
    ctx.errors = ['Error: short error 1', 'Error: short error 2'];

    const result = engine.formatContextDetails(ctxId);
    expect(result).toContain('Error: short error 1');
    expect(result).toContain('Error: short error 2');
    expect(result).not.toContain('错误已省略');
  });

  test('大量错误累计超 600 字符后省略多余错误', () => {
    const engine = new ContextEngine(mockClient());
    const ctxId = engine.registerContext({ description: 'test' });
    const ctx = (engine as never).registry.get(ctxId);
    // 10 条各 200 字符的错误 → 累计 10 * (2 + 200) = 2020 字符，远超 600
    ctx.errors = Array.from({ length: 10 }, (_, i) => `Error: long error line ${i} `.padEnd(200, 'x'));

    const result = engine.formatContextDetails(ctxId);
    // 总和应 ≤ 600
    const errorSection = result.split('### ⚠️ 近期错误')[1]?.split('###')[0] ?? '';
    const errorLines = errorSection.split('\n').filter((l) => l.startsWith('- '));
    let totalChars = 0;
    for (const line of errorLines) {
      totalChars += line.length;
    }
    expect(totalChars).toBeLessThanOrEqual(650); // 略宽松，因标题行不计入
    expect(result).toContain('错误已省略');
  });

  test('恰好一条超长错误累积到 600 边界也能正确省略', () => {
    const engine = new ContextEngine(mockClient());
    const ctxId = engine.registerContext({ description: 'test' });
    const ctx = (engine as never).registry.get(ctxId);
    // 1 条 600 字符的错误，加 "- " = 602，超过 600 应被省略
    ctx.errors = ['E: ' + 'x'.repeat(596)];

    const result = engine.formatContextDetails(ctxId);
    expect(result).toContain('错误已省略');
    // 那条错误本身不应出现
    expect(result).not.toContain('E: ' + 'x'.repeat(10));
  });

  test('无错误时不输出错误部分', () => {
    const engine = new ContextEngine(mockClient());
    const ctxId = engine.registerContext({ description: 'test' });
    const result = engine.formatContextDetails(ctxId);
    expect(result).not.toContain('⚠️ 近期错误');
    expect(result).not.toContain('错误已省略');
  });
});

// ===========================================================================
// formatContextDetails — 依赖结果渲染截断
// ===========================================================================
describe('formatContextDetails 依赖结果渲染截断', () => {
  test('短 keyOutput 不截断', () => {
    const engine = new ContextEngine(mockClient());
    const ctxId = engine.registerContext({ description: 'test' });
    const ctx = (engine as never).registry.get(ctxId);
    ctx.dependencies = [
      { alias: 'dep-1', agent: 'co-explorer', keyOutput: 'short output', capturedAt: Date.now() },
    ];

    const result = engine.formatContextDetails(ctxId);
    expect(result).toContain('short output');
    expect(result).not.toContain('…');
  });

  test('超长 keyOutput 被截断到 200 字符并追加省略号', () => {
    const engine = new ContextEngine(mockClient());
    const ctxId = engine.registerContext({ description: 'test' });
    const ctx = (engine as never).registry.get(ctxId);
    ctx.dependencies = [
      { alias: 'dep-1', agent: 'co-explorer', keyOutput: 'x'.repeat(300), capturedAt: Date.now() },
    ];

    const result = engine.formatContextDetails(ctxId);
    expect(result).toContain('…');
    // 提取依赖输出部分
    const depSection = result.split('### 📦 依赖结果')[1]?.split('###')[0] ?? '';
    // 提取实际输出的部分（在 "**: " 之后）
    const outputMatch = depSection.match(/\*\*co-explorer\*\*: (.+)/);
    expect(outputMatch).not.toBeNull();
    const outputText = outputMatch![1];
    expect(outputText.length).toBeLessThanOrEqual(203); // 200 + 1(…)
    expect(outputText).toBe('x'.repeat(200) + '…');
  });
});

// ===========================================================================
// captureResult 截断
// ===========================================================================
describe('captureResult 截断', () => {
  test('超大 keyOutput 被截断到 dependencyKeyOutputChars（200）', async () => {
    // 构造 mock 消息，模拟 SDK 返回
    const mockMessages = [
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'x'.repeat(500) }],
      },
    ];
    const client = {
      session: {
        messages: async () => ({ data: mockMessages }),
      },
    };

    const engine = new ContextEngine(client as never);
    const result = await engine.captureResult('ses-xxx', 'test-alias', 'co-explorer');
    expect(result).not.toBeNull();
    expect(result!.output.length).toBe(200);
    expect(result!.output).toBe('x'.repeat(200));
  });

  test('短 keyOutput 保持原样', async () => {
    const mockMessages = [
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'short output' }],
      },
    ];
    const client = {
      session: {
        messages: async () => ({ data: mockMessages }),
      },
    };

    const engine = new ContextEngine(client as never);
    const result = await engine.captureResult('ses-xxx', 'test-alias', 'co-explorer');
    expect(result).not.toBeNull();
    expect(result!.output).toBe('short output');
  });

  test('空消息返回空 output', async () => {
    const client = {
      session: {
        messages: async () => ({ data: [] }),
      },
    };

    const engine = new ContextEngine(client as never);
    const result = await engine.captureResult('ses-xxx', 'test-alias', 'co-explorer');
    // 没有 assistant 消息，keyOutput 为空 → 返回 { output: '', decisions: 0 }
    expect(result).toEqual({ output: '', decisions: 0 });
  });
});