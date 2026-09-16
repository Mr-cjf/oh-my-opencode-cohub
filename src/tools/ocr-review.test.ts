// src/tools/ocr-review.test.ts
// 验证 ocr-review 工具：参数构建、输出格式化、降级路径、权限校验
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { describe, test, expect, vi } from 'bun:test';

// ===========================================================================
// Mock @opencode-ai/plugin — 拦截 tool() 返回 execute
// ===========================================================================
vi.mock('@opencode-ai/plugin', () => {
  const mockDescribe = () => ({});
  const mockOptional = () => ({ describe: mockDescribe });
  const mockString = () => ({ describe: mockDescribe, optional: mockOptional });

  const tool = Object.assign(
    (config: Record<string, unknown>) => ({ ...config }),
    { schema: { string: mockString } },
  );

  return { tool };
});

// ===========================================================================
// 导入被测模块（mock 生效后导入）
// ===========================================================================
import {
  buildOcrArgs,
  formatOcrOutput,
  createOcrReviewTool,
} from './ocr-review';

// ===========================================================================
// A. buildOcrArgs — CLI 参数构建
// ===========================================================================
describe('buildOcrArgs', () => {
  const PROJECT_DIR = '/test/project';

  test('只传 from 时包含默认参数', () => {
    const args = buildOcrArgs({ from: 'main' }, PROJECT_DIR);

    expect(args).toContain('review');
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args).toContain('--audience');
    expect(args).toContain('agent');
    expect(args).toContain('--repo');
    expect(args).toContain(PROJECT_DIR);
    expect(args).toContain('--from');
    expect(args).toContain('main');
    expect(args).toContain('--to');
    expect(args).toContain('HEAD');
    expect(args).toContain('--max-git-procs');
    expect(args).toContain('8');
  });

  test('preview: false 时不包含 --preview', () => {
    const args = buildOcrArgs({ from: 'main', preview: false }, PROJECT_DIR);

    expect(args).not.toContain('--preview');
  });

  test('preview: true 时包含 --preview', () => {
    const args = buildOcrArgs({ from: 'main', preview: true }, PROJECT_DIR);

    expect(args).toContain('--preview');
  });

  test('不传 preview（undefined）时默认包含 --preview', () => {
    const args = buildOcrArgs({ from: 'main' }, PROJECT_DIR);

    expect(args).toContain('--preview');
  });

  test('传 background 时包含 --background <值>', () => {
    const args = buildOcrArgs(
      { from: 'main', background: '支付模块重构' },
      PROJECT_DIR,
    );

    expect(args).toContain('--background');
    expect(args).toContain('支付模块重构');
  });

  test('传 to 时覆盖默认 HEAD', () => {
    const args = buildOcrArgs({ from: 'main', to: 'feature-branch' }, PROJECT_DIR);

    expect(args).toContain('--to');
    expect(args).toContain('feature-branch');
    expect(args).not.toContain('HEAD');
  });
});

// ===========================================================================
// B. formatOcrOutput — 输出格式化与截断
// ===========================================================================
describe('formatOcrOutput', () => {
  test('20 条 comments → 按 severity 排序后保留前 15 条，含截断提示', () => {
    const comments = Array.from({ length: 20 }, (_, i) => ({
      path: `src/file${i}.ts`,
      start_line: i,
      end_line: i + 1,
      severity: 'warning',
      category: 'style',
      content: `Comment ${i + 1}`,
    }));
    const input = JSON.stringify({
      status: 'completed',
      comments,
    });

    const output = formatOcrOutput(input);

    expect(output).toContain('Comments (15/20)');
    expect(output).toContain('优先级最高的前 15 条');
    // 第 16 条应被截断，不应出现
    expect(output).not.toContain('Comment 16');
  });

  test('单条 content 超过 200 字符 → 截断并追加 ...', () => {
    const longContent = 'a'.repeat(250);
    const input = JSON.stringify({
      status: 'completed',
      comments: [
        {
          path: 'src/main.ts',
          start_line: 1,
          end_line: 10,
          severity: 'error',
          category: 'bug',
          content: longContent,
        },
      ],
    });

    const output = formatOcrOutput(input);

    // 应包含前 200 个 'a' + '...'
    expect(output).toContain('a'.repeat(200) + '...');
    expect(output).not.toContain(longContent); // 原始完整内容不应出现
  });

  test('10 条 warnings → 只保留 5 条', () => {
    const warnings = Array.from({ length: 10 }, (_, i) => `Warning ${i + 1}`);
    const input = JSON.stringify({
      status: 'completed',
      warnings,
    });

    const output = formatOcrOutput(input);

    expect(output).toContain('Warnings (5/10)');
    expect(output).toContain('仅展示前 5 条');
    // 第 6 条应被截断
    expect(output).not.toContain('Warning 6');
  });

  test('非 JSON 字符串 → 原样返回', () => {
    const raw = '这是 preview 模式的纯文本输出\nsrc/file1.ts\nsrc/file2.ts';

    const output = formatOcrOutput(raw);

    expect(output).toBe(raw);
  });

  test('summary 和 session_id 被保留', () => {
    const input = JSON.stringify({
      status: 'completed',
      session_id: 'ses_abc123',
      summary: '发现 3 个性能问题',
    });

    const output = formatOcrOutput(input);

    expect(output).toContain('ses_abc123');
    expect(output).toContain('发现 3 个性能问题');
  });

  test('groups 信息被渲染', () => {
    const input = JSON.stringify({
      status: 'completed',
      groups: [
        { name: '核心模块', file_count: 5 },
        { name: '测试模块', file_count: 3 },
      ],
    });

    const output = formatOcrOutput(input);

    expect(output).toContain('Groups (2)');
    expect(output).toContain('核心模块: 5 files');
    expect(output).toContain('测试模块: 3 files');
  });

  test('suggestion_code 超过 200 字符 → 截断', () => {
    const longCode = 'b'.repeat(250);
    const input = JSON.stringify({
      status: 'completed',
      comments: [
        {
          path: 'src/main.ts',
          start_line: 1,
          end_line: 1,
          severity: 'info',
          category: 'refactor',
          content: 'short',
          suggestion_code: longCode,
        },
      ],
    });

    const output = formatOcrOutput(input);

    expect(output).toContain('b'.repeat(200) + '...');
  });
});

// ===========================================================================
// C. 降级路径 — OCR CLI 未安装
// ===========================================================================
describe('createOcrReviewTool — 降级路径', () => {
  test('ocrAvailable=false → 返回含"未安装"的提示字符串，不抛异常', async () => {
    const toolDef = createOcrReviewTool({} as any, '/fake/path', false);

    const result = await toolDef.co_ocr_review.execute(
      { from: 'main' },
      { sessionID: 'test-ses', agent: 'co-oracle' },
    );

    expect(typeof result).toBe('string');
    expect(result).toContain('未安装');
  });

  test('降级提示包含安装命令和重启说明', async () => {
    const toolDef = createOcrReviewTool({} as any, '/fake/path', false);

    const result = await toolDef.co_ocr_review.execute(
      { from: 'main' },
      { sessionID: 'test-ses', agent: 'co-oracle' },
    );

    expect(result).toContain('npm install -g @alibaba-group/open-code-review');
    expect(result).toContain('重启 OpenCode');
  });
});

// ===========================================================================
// D. 权限校验 — 仅 co-oracle 可调用
// ===========================================================================
describe('createOcrReviewTool — 权限校验', () => {
  test('agent=co-fixer → 抛出异常含"仅限 co-oracle"', async () => {
    const toolDef = createOcrReviewTool({} as any, '/fake/path', true);

    await expect(
      toolDef.co_ocr_review.execute(
        { from: 'main' },
        { sessionID: 'test-ses', agent: 'co-fixer' },
      ),
    ).rejects.toThrow('仅限 co-oracle');
  });

  test('agent=co-oracle → 权限校验通过后走降级路径（不真实 spawn）', async () => {
    // 使用 ocrAvailable=false 让用例走降级路径，确保不真实 spawn CLI
    // 同时验证权限校验（agent=co-oracle 应通过）先于依赖检查
    const toolDef = createOcrReviewTool({} as any, '/fake/path', false);

    const result = await toolDef.co_ocr_review.execute(
      { from: 'main' },
      { sessionID: 'test-ses', agent: 'co-oracle' },
    );

    // 权限校验通过 → 走到降级路径 → 返回的是降级提示（含"未安装"）
    expect(result).toContain('未安装');
    // 不会发起 spawn（若 spawn 会触发 ENOENT 错误消息，而非降级提示）
    expect(result).not.toContain('ENOENT');
  });
});