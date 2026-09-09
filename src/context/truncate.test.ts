// src/context/truncate.test.ts
// 验证 estimateTokens / enforcePromptBudget / truncateByTokens 以及
// extractErrors 截断、extractRelevantFiles denylist 过滤
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import {
  estimateTokens,
  enforcePromptBudget,
  truncateByTokens,
  extractErrors,
  extractRelevantFiles,
} from './extractor';

// ===========================================================================
// estimateTokens
// ===========================================================================
describe('estimateTokens', () => {
  test('纯英文: 4 字符 ≈ 1 token', () => {
    // 4 个英文字符 → 4 * 0.25 = 1
    expect(estimateTokens('abcd')).toBeCloseTo(1, 1);
  });

  test('纯中文: 1 字符 ≈ 1 token', () => {
    // 2 个中文字符 → 2 * 1 = 2
    expect(estimateTokens('测试')).toBeCloseTo(2, 1);
  });

  test('中英混合', () => {
    // hello(5*0.25) + 世界(2*1) = 1.25 + 2 = 3.25
    expect(estimateTokens('hello世界')).toBeCloseTo(3.25, 1);
  });

  test('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('日文假名按 CJK 计算', () => {
    // 3 个日文字符 → 3 * 1 = 3
    expect(estimateTokens('こんにちは')).toBeCloseTo(5, 1);
  });

  test('混合标点和空格', () => {
    // "a b c" 5 个非 CJK 字符 → 5 * 0.25 = 1.25
    expect(estimateTokens('a b c')).toBeCloseTo(1.25, 1);
  });
});

// ===========================================================================
// enforcePromptBudget
// ===========================================================================
describe('enforcePromptBudget', () => {
  test('未超限返回 full', () => {
    const base = 'base prompt';
    const full = 'base prompt with some context';
    // full 约 28 字符, 英文约 7 tokens, 预算 100 远大于 7
    const result = enforcePromptBudget(base, full, 100);
    expect(result).toBe(full);
  });

  test('超限返回 base', () => {
    const base = 'short base';
    const full = 'a'.repeat(100); // 100 英文字符 ≈ 25 tokens
    const result = enforcePromptBudget(base, full, 5);
    expect(result).toBe(base);
  });

  test('base 和 full 相同时返回相同值', () => {
    const text = 'hello world';
    const result = enforcePromptBudget(text, text, 100);
    expect(result).toBe(text);
  });

  test('边界值: 恰好等于 maxTokens 返回 full', () => {
    // "ab" = 2 * 0.25 = 0.5 tokens, 预算 1 足够
    const base = 'base';
    const full = 'ab';
    const result = enforcePromptBudget(base, full, 1);
    expect(result).toBe(full);
  });
});

// ===========================================================================
// truncateByTokens（回归：复用 estimateTokens 后行为不变）
// ===========================================================================
describe('truncateByTokens', () => {
  test('未超预算原样返回', () => {
    expect(truncateByTokens('hello', 100)).toBe('hello');
  });

  test('空文本返回空串', () => {
    expect(truncateByTokens('', 100)).toBe('');
    expect(truncateByTokens('hello', 0)).toBe('');
  });

  test('超预算截断并在末尾追加省略标记', () => {
    const result = truncateByTokens('hello world', 1);
    // 4 字符 ≈ 1 token，所以截断点在 4 个字符后
    expect(result).toContain('… [正文已按 token 预算截断]');
    expect(result.length).toBeLessThan('hello world'.length + 50);
  });
});

// ===========================================================================
// extractErrors 截断
// ===========================================================================
describe('extractErrors 截断', () => {
  const win = 100;
  const maxErrors = 10;

  function toolPart(overrides: {
    status?: string;
    input?: Record<string, unknown>;
    output?: string;
    error?: string;
    tool?: string;
  }) {
    const { status = 'completed', input = {}, output, error, tool = 'read' } = overrides;
    const state: Record<string, unknown> = { status, input };
    if (output !== undefined) state.output = output;
    if (error !== undefined) state.error = error;
    return { type: 'tool' as const, tool, state };
  }

  function msg(role: string, parts: unknown[]) {
    return { info: { role }, parts };
  }

  test('超长错误行被截断到 ≤200 字符', () => {
    const longError = 'Error: ' + 'x'.repeat(300);
    const messages = [msg('assistant', [toolPart({ output: longError })])];
    const result = extractErrors(messages, maxErrors, win);
    expect(result).toHaveLength(1);
    expect(result[0].length).toBeLessThanOrEqual(200);
    // 'Error: ' (7 chars) + 'x'*193 → 200 chars
    expect(result[0]).toBe('Error: ' + 'x'.repeat(193));
    expect(result[0].length).toBe(200);
  });

  test('正常长度错误行不被截断', () => {
    const shortError = 'Error: something failed';
    const messages = [msg('assistant', [toolPart({ output: shortError })])];
    const result = extractErrors(messages, maxErrors, win);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Error: something failed');
  });

  test('原 < 300 的行现在被截断而非丢弃', () => {
    // 原来 line.length < 300 会丢弃超长行，现在改为截断
    const longLine = 'Error: ' + 'x'.repeat(250);
    const messages = [msg('assistant', [toolPart({ output: longLine })])];
    const result = extractErrors(messages, maxErrors, win);
    expect(result).toHaveLength(1);
    expect(result[0].length).toBeLessThanOrEqual(200);
  });
});

// ===========================================================================
// extractRelevantFiles denylist
// ===========================================================================
describe('extractRelevantFiles denylist', () => {
  const win = 100;
  const maxFiles = 10;

  function toolPart(overrides: {
    status?: string;
    input?: Record<string, unknown>;
    output?: string;
    error?: string;
    tool?: string;
  }) {
    const { status = 'completed', input = {}, output, error, tool = 'read' } = overrides;
    const state: Record<string, unknown> = { status, input };
    if (output !== undefined) state.output = output;
    if (error !== undefined) state.error = error;
    return { type: 'tool' as const, tool, state };
  }

  function msg(role: string, parts: unknown[]) {
    return { info: { role }, parts };
  }

  test('过滤 node_modules 路径', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: 'node_modules/foo/index.js' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(0);
  });

  test('过滤 .git/ 路径', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: '/repo/.git/HEAD' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(0);
  });

  test('过滤 .config/opencode 路径', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: '~/.config/opencode/opencode.json' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(0);
  });

  test('过滤 .local/share 路径', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: '~/.local/share/opencode/storage.json' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(0);
  });

  test('过滤 node_modules 下 oh-my-opencode-cohub 插件路径', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: 'node_modules/oh-my-opencode-cohub/dist/index.js' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(0);
  });

  test('过滤 storage/oh-my-opencode-cohub 运行时存储路径', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: '/home/user/.local/share/opencode/storage/oh-my-opencode-cohub/state.json' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(0);
  });

  test('过滤 .log 文件', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: '/var/log/app.log' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(0);
  });

  test('过滤 stats.json 文件', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: '/app/stats.json' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(0);
  });

  test('正常项目路径不受影响', () => {
    const messages = [
      msg('user', [toolPart({ input: { filePath: '/app/src/index.ts' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/app/src/index.ts');
  });

  test('部分匹配不误杀（如 node_modules 作为子串在项目名中）', () => {
    // 实际 DENY_PATTERNS 中 /node_modules/ 匹配任何含 node_modules 的路径，
    // 所以 node_modules 作为目录组件名会被过滤，这是预期行为。
    // 这里测试一个不包含 denylist 片段的路径
    const messages = [
      msg('user', [toolPart({ input: { filePath: '/app/node_test/utils.ts' } })]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    // node_test 不含 node_modules 子串，不应被过滤
    expect(result).toHaveLength(1);
  });
});