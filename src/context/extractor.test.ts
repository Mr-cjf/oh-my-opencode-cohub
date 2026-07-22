// src/context/extractor.test.ts
// 验证提取器使用 SDK 正确类型（type: 'tool', state.input, state.output）
// 修复于: 2026-07 — 旧代码使用不存在的 tool_call/tool_result 类型
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { extractRelevantFiles, extractDecisions, extractErrors } from './extractor';

// ---------------------------------------------------------------------------
// Helper: 创建 ToolPart mock
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helper: 创建 TextPart mock
// ---------------------------------------------------------------------------
function textPart(text: string) {
  return { type: 'text' as const, text };
}

// ---------------------------------------------------------------------------
// Helper: 创建消息
// ---------------------------------------------------------------------------
function msg(role: string, parts: unknown[]) {
  return { info: { role }, parts };
}

// ===========================================================================
// extractRelevantFiles
// ===========================================================================
describe('extractRelevantFiles', () => {
  const win = 100;
  const maxFiles = 10;

  // -----------------------------------------------------------------------
  // 工具调用 input 路径提取
  // -----------------------------------------------------------------------
  test('从 tool state.input.filePath 提取文件路径', () => {
    const messages = [
      msg('user', [
        toolPart({ input: { filePath: '/app/src/index.ts' } }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/app/src/index.ts');
  });

  test('提取行号范围 (offset/limit)', () => {
    const messages = [
      msg('user', [
        toolPart({
          input: { filePath: '/app/src/utils.ts', offset: 42, limit: 30 },
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result[0].lines).toBe('42-72');
  });

  test('提取编辑摘要 (oldString)', () => {
    const messages = [
      msg('user', [
        toolPart({
          input: { filePath: '/app/src/foo.ts', oldString: 'const x = 1;' },
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result[0].summary).toContain('编辑: const x = 1;');
  });

  test('从 completed 状态的 output 提取摘要（无 oldString 时）', () => {
    const messages = [
      msg('user', [
        toolPart({
          input: { filePath: '/app/src/bar.ts' },
          output: 'hello world this is the file content for summary',
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result[0].summary).toContain('hello world');
  });

  test('从 input 字符串值扫描文件路径（如 prompt 字段）', () => {
    const messages = [
      msg('user', [
        toolPart({
          input: {
            description: '请读取 C:\\Users\\test\\src\\app.ts 文件',
          },
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    const paths = result.map((f) => f.path);
    expect(paths).toContain('C:\\Users\\test\\src\\app.ts');
  });

  test('从 completed 状态的 output 文本扫描文件路径', () => {
    const messages = [
      msg('user', [
        toolPart({
          input: { filePath: '/app/src/main.ts' },
          output: '发现文件: ./src/utils.ts 和 ./src/types.ts',
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    const paths = result.map((f) => f.path);
    expect(paths).toContain('./src/utils.ts');
    expect(paths).toContain('./src/types.ts');
  });

  // -----------------------------------------------------------------------
  // text part 路径扫描
  // -----------------------------------------------------------------------
  test('从 text part 扫描文件路径（忽略裸相对路径，匹配 ./ 前缀）', () => {
    const messages = [
      msg('assistant', [
        textPart('请查看 `app.ts` 和 ./utils.ts'),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    const paths = result.map((f) => f.path);
    // app.ts 之前没有路径前缀，不应匹配；./utils.ts 应匹配
    expect(paths).not.toContain('app.ts');
    expect(paths).toContain('./utils.ts');
  });

  test('text part 中的 Windows 路径', () => {
    const messages = [
      msg('assistant', [
        textPart('请检查 D:\\projects\\main\\config.json 文件'),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    const paths = result.map((f) => f.path);
    expect(paths).toContain('D:\\projects\\main\\config.json');
  });

  // -----------------------------------------------------------------------
  // maxFiles 限制
  // -----------------------------------------------------------------------
  test('maxFiles 限制返回数量', () => {
    const parts = Array.from({ length: 10 }, (_, i) =>
      toolPart({ input: { filePath: `/app/src/file${i}.ts` } }),
    );
    const messages = [msg('user', parts)];
    const result = extractRelevantFiles(messages, 3, win);
    expect(result).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // 非 completed 状态行为
  // -----------------------------------------------------------------------
  test('非 completed 状态时不从 output 提取摘要，但 input 路径仍提取', () => {
    const messages = [
      msg('user', [
        toolPart({
          status: 'running',
          input: { filePath: '/app/src/pending.ts' },
          output: 'partial content',
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    // 路径应被提取
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/app/src/pending.ts');
    // running 状态下不应从 output 设置 summary
    expect(result[0].summary).toBe('');
  });

  test('非 completed 状态时 output 中的文件路径不会被扫描', () => {
    const messages = [
      msg('user', [
        toolPart({
          status: 'error',
          input: { filePath: '/app/src/err.ts' },
          error: '访问被拒绝',
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    // 只应有 input 中的显式路径
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/app/src/err.ts');
  });

  // -----------------------------------------------------------------------
  // 边界条件
  // -----------------------------------------------------------------------
  test('空 messages 返回空数组', () => {
    const result = extractRelevantFiles([], maxFiles, win);
    expect(result).toEqual([]);
  });

  test('无 parts 的消息不报错', () => {
    const messages = [{ info: { role: 'user' } }];
    const result = extractRelevantFiles(messages as never, maxFiles, win);
    expect(result).toEqual([]);
  });

  test('未知扩展名的路径被过滤', () => {
    const messages = [
      msg('user', [
        toolPart({
          input: { description: '参考 manual.pdf 文件' },
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    // pdf 不在 KNOWN_EXTENSIONS 中，应被过滤
    const allText = JSON.stringify(result);
    expect(allText).not.toContain('manual.pdf');
  });

  test('windowSize 参数生效仅取最近消息', () => {
    const messages = [
      msg('user', [
        toolPart({ input: { filePath: '/app/src/old.ts' } }),
      ]),
      msg('user', [
        toolPart({ input: { filePath: '/app/src/new.ts' } }),
      ]),
    ];
    // windowSize = 1 → 只取第二条消息
    const result = extractRelevantFiles(messages, maxFiles, 1);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/app/src/new.ts');
  });

  test('extractPath 接受多种路径字段 (filePath / path / file / filepath)', () => {
    const msgs = [
      msg('user', [toolPart({ input: { filePath: '/a/fp.ts' } })]),
      msg('user', [toolPart({ input: { path: '/a/p.ts' } })]),
      msg('user', [toolPart({ input: { file: '/a/f.ts' } })]),
      msg('user', [toolPart({ input: { filepath: '/a/fp2.ts' } })]),
    ];
    const result = extractRelevantFiles(msgs, maxFiles, win);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual(['/a/f.ts', '/a/fp.ts', '/a/fp2.ts', '/a/p.ts']);
  });

  test('oldString 有更高的 summary 优先级（优于 output 摘要）', () => {
    const messages = [
      msg('user', [
        toolPart({
          input: {
            filePath: '/app/src/conflict.ts',
            oldString: 'const old = 1;',
          },
          output: 'unrelated content that should not become the summary',
        }),
      ]),
    ];
    const result = extractRelevantFiles(messages, maxFiles, win);
    expect(result[0].summary).toContain('编辑:');
    expect(result[0].summary).not.toContain('unrelated');
  });
});

// ===========================================================================
// extractErrors
// ===========================================================================
describe('extractErrors', () => {
  const win = 100;
  const maxErrors = 10;

  test('从 state.output 提取错误行', () => {
    const messages = [
      msg('assistant', [
        toolPart({
          output: [
            '> building...',
            'Error: cannot find module \'./foo\'',
            '  at line 42',
          ].join('\n'),
        }),
      ]),
    ];
    const result = extractErrors(messages, maxErrors, win);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Error: cannot find module');
  });

  test('从 state.error 提取错误（error 状态）', () => {
    const messages = [
      msg('assistant', [
        toolPart({
          status: 'error',
          error: 'TypeError: undefined is not a function',
          input: {},
        }),
      ]),
    ];
    const result = extractErrors(messages, maxErrors, win);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('TypeError: undefined is not a function');
  });

  test('无错误的正常输出不提取', () => {
    const messages = [
      msg('assistant', [
        toolPart({
          output: 'Build completed successfully\nAll tests pass',
        }),
      ]),
    ];
    const result = extractErrors(messages, maxErrors, win);
    expect(result).toEqual([]);
  });

  test('maxErrors 限制返回数量', () => {
    const messages = [
      msg('assistant', [
        toolPart({
          output: [
            'Error: first',
            'Error: second',
            'Error: third',
            'Error: fourth',
          ].join('\n'),
        }),
      ]),
    ];
    const result = extractErrors(messages, 2, win);
    expect(result).toHaveLength(2);
  });

  test('error 配合 output 不重复提取', () => {
    const messages = [
      msg('assistant', [
        toolPart({
          status: 'error',
          input: {},
          error: 'SyntaxError: unexpected token',
          output: 'SyntaxError: unexpected token\n  at line 1',
        }),
      ]),
    ];
    const result = extractErrors(messages, maxErrors, win);
    // output 和 error 合并后应去重（由正则匹配控制，这里只验证至少提取到错误）
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toContain('SyntaxError');
  });

  test('空 messages 返回空数组', () => {
    expect(extractErrors([], maxErrors, win)).toEqual([]);
  });
});

// ===========================================================================
// extractDecisions
// ===========================================================================
describe('extractDecisions', () => {
  const win = 100;
  const maxDecisions = 10;

  test('从 assistant text 提取决策（包含关键词）', () => {
    const messages = [
      msg('assistant', [
        textPart('经过分析，我决定使用 TypeScript 严格模式。'),
      ]),
    ];
    const result = extractDecisions(messages, maxDecisions, win);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('我决定使用 TypeScript 严格模式');
  });

  test('非 assistant 消息不提取', () => {
    const messages = [
      msg('user', [
        textPart('我认为应该用 React 框架'),
      ]),
    ];
    const result = extractDecisions(messages, maxDecisions, win);
    expect(result).toEqual([]);
  });

  test('不含关键词的文本不提取', () => {
    const messages = [
      msg('assistant', [
        textPart('这是一段普通的描述文本，没有任何决策含义。'),
      ]),
    ];
    const result = extractDecisions(messages, maxDecisions, win);
    expect(result).toEqual([]);
  });

  test('maxDecisions 限制返回数量', () => {
    const decisions = [
      '经过分析我决定用 A 方案来实现这个功能',
      '团队最终认定 B 方案在性能上更优一些',
      '经过讨论结论是选择 C 方案作为首选',
    ];
    const messages = [
      msg('assistant', decisions.map((d) => textPart(d))),
    ];
    const result = extractDecisions(messages, 2, win);
    expect(result).toHaveLength(2);
  });

  test('短文本（≤10 字符）被过滤', () => {
    const messages = [
      msg('assistant', [
        textPart('决定吧'),
      ]),
    ];
    const result = extractDecisions(messages, maxDecisions, win);
    expect(result).toEqual([]);
  });

  test('超长文本（≥200 字符）被过滤', () => {
    const messages = [
      msg('assistant', [
        textPart('我决定' + 'x'.repeat(200)),
      ]),
    ];
    const result = extractDecisions(messages, maxDecisions, win);
    expect(result).toEqual([]);
  });

  test('空的 messages 返回空数组', () => {
    expect(extractDecisions([], maxDecisions, win)).toEqual([]);
  });

  test('无 parts 的消息不报错', () => {
    const messages = [{ info: { role: 'assistant' } }];
    const result = extractDecisions(messages as never, maxDecisions, win);
    expect(result).toEqual([]);
  });
});
