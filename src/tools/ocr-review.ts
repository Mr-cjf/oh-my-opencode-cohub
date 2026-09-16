// src/tools/ocr-review.ts
//
// co_ocr_review tool for oh-my-opencode-cohub.
// Provides optional integration with the local @alibaba-group/open-code-review CLI
// for structured code review. Soft dependency: if OCR is not installed,
// returns a guidance string instead of throwing.

import { tool } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import { execSync, spawn } from 'node:child_process';

// zod access via tool.schema（与 council.ts / job-control.ts 相同的模式）
const z = tool.schema;

// ============================================================================
// CLI detection with module-level cache
// ============================================================================

let _ocrAvailable: boolean | undefined;

/**
 * Detect whether the `ocr` CLI is available on the system.
 * Result is cached in a module-level variable after the first call.
 * Pass `force = true` to re-detect.
 */
export async function detectOcrCli(force = false): Promise<boolean> {
  if (!force && _ocrAvailable !== undefined) return _ocrAvailable;
  try {
    execSync('ocr version', { stdio: 'pipe', timeout: 5000 });
    _ocrAvailable = true;
  } catch {
    _ocrAvailable = false;
  }
  return _ocrAvailable;
}

// ============================================================================
// CLI argument builder
// ============================================================================

interface OcrArgsInput {
  from: string;
  to?: string;
  background?: string;
  preview?: boolean;
}

/**
 * Build the CLI argument array for the `ocr` command.
 */
export function buildOcrArgs(input: OcrArgsInput, projectDir: string): string[] {
  const args: string[] = [
    'review',
    '--format', 'json',
    '--audience', 'agent',
    '--repo', projectDir,
    '--from', input.from,
    '--to', input.to || 'HEAD',
    '--max-git-procs', '8',
  ];
  if (input.background) {
    args.push('--background', input.background);
  }
  // preview 默认 true（未传或传 true 都开启预览）；显式传 false 才跳过
  if (input.preview !== false) {
    args.push('--preview');
  }
  return args;
}

// ============================================================================
// CLI execution with timeout and stream capture
// ============================================================================

const OCR_TIMEOUT_MS = 600_000; // 10 分钟
const MAX_STDOUT_CHARS = 10 * 1024 * 1024; // ~10MB 字符截断上限

interface OcrExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  exitCode: number | null;
}

/**
 * Execute the `ocr` CLI via spawn and collect output.
 * Returns a structured result instead of throwing on failure.
 */
async function executeOcrReview(
  args: string[],
  projectDir: string,
): Promise<OcrExecutionResult> {
  return new Promise<OcrExecutionResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;

    const child = spawn('ocr', args, {
      cwd: projectDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Collect stdout with truncation guard
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const remaining = MAX_STDOUT_CHARS - stdout.length;
      if (remaining <= 0) {
        stdoutTruncated = true;
        return;
      }
      stdout += chunk.toString('utf8').slice(0, remaining);
    });

    // Collect stderr (usually small, no truncation needed)
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    // Timeout guard: kill child if exceeds OCR_TIMEOUT_MS
    let sigkillTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      // Grace period before forceful kill
      sigkillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2000).unref();
    }, OCR_TIMEOUT_MS);
    timer.unref();

    // Error handler — captures ENOENT and similar spawn failures
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      const isENOENT = error.code === 'ENOENT';
      const message = isENOENT
        ? 'ENOENT: OCR CLI not found'
        : `Failed to start OpenCodeReview: ${error.message}`;
      resolve({
        success: false,
        stdout: '',
        stderr: message,
        truncated: false,
        exitCode: null,
      });
    });

    child.on('close', (exitCode: number | null) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      resolve({
        success: exitCode === 0,
        stdout,
        stderr,
        truncated: stdoutTruncated,
        exitCode,
      });
    });
  });
}

// ============================================================================
// Output formatter — truncation & summary
// ============================================================================

const MAX_COMMENTS = 15;
const MAX_WARNINGS = 5;
const MAX_FIELD_LENGTH = 200;

interface OcrComment {
  path?: string;
  start_line?: number;
  end_line?: number;
  category?: string;
  severity?: string;
  content?: string;
  suggestion_code?: string;
}

interface OcrGroup {
  name?: string;
  file_count?: number;
}

interface OcrOutput {
  status?: string;
  llm?: { provider?: string; model?: string };
  session_id?: string;
  summary?: string;
  comments?: OcrComment[];
  warnings?: string[];
  groups?: OcrGroup[];
  [key: string]: unknown;
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncateField(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + '...';
}

/**
 * Format OCR output with truncation to prevent context flooding.
 * If the output is not valid JSON (e.g. preview mode plain text),
 * returns the raw text directly.
 */
export function formatOcrOutput(raw: string): string {
  let parsed: OcrOutput;
  try {
    parsed = JSON.parse(raw) as OcrOutput;
  } catch {
    // Not JSON — likely preview mode file list; return as-is
    return raw;
  }

  const lines: string[] = [];

  // Header
  lines.push('--- OCR Review Result ---');
  lines.push(`Status: ${parsed.status ?? 'unknown'}`);
  if (parsed.llm) {
    lines.push(
      `LLM: ${parsed.llm.provider ?? '?'}/${parsed.llm.model ?? '?'}`,
    );
  }
  if (parsed.session_id) {
    lines.push(`Session ID: ${parsed.session_id}`);
  }
  lines.push('');

  // Summary
  if (parsed.summary) {
    lines.push('=== Summary ===');
    lines.push(parsed.summary);
    lines.push('');
  }

  // Comments (truncated to MAX_COMMENTS, sorted by severity)
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const comments = parsed.comments ?? [];
  if (comments.length > 0) {
    const sorted = [...comments].sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity ?? ''] ?? 4) -
        (SEVERITY_ORDER[b.severity ?? ''] ?? 4),
    );
    const displayComments = sorted.slice(0, MAX_COMMENTS);
    lines.push(
      `=== Comments (${displayComments.length}/${comments.length}) ===`,
    );
    for (const c of displayComments) {
      const loc = c.path
        ? `${c.path}:${c.start_line ?? '?'}-${c.end_line ?? '?'}`
        : 'unknown location';
      lines.push(`- [${c.severity ?? 'info'}/${c.category ?? 'general'}] ${loc}`);
      if (c.content) {
        lines.push(`  Content: ${truncateField(c.content, MAX_FIELD_LENGTH)}`);
      }
      if (c.suggestion_code) {
        lines.push(
          `  Suggestion: ${truncateField(c.suggestion_code, MAX_FIELD_LENGTH)}`,
        );
      }
      lines.push('');
    }
    if (comments.length > MAX_COMMENTS) {
      lines.push(
        `...（共 ${comments.length} 条评论，此处仅展示优先级最高的前 ${MAX_COMMENTS} 条。可用 session_id 继续）`,
      );
      lines.push('');
    }
  }

  // Warnings (truncated to MAX_WARNINGS)
  const warnings = parsed.warnings ?? [];
  if (warnings.length > 0) {
    const displayWarnings = warnings.slice(0, MAX_WARNINGS);
    lines.push(`=== Warnings (${displayWarnings.length}/${warnings.length}) ===`);
    for (const w of displayWarnings) {
      lines.push(`- ${truncateField(w, MAX_FIELD_LENGTH)}`);
    }
    if (warnings.length > MAX_WARNINGS) {
      lines.push(
        `...（共 ${warnings.length} 条警告，此处仅展示前 ${MAX_WARNINGS} 条）`,
      );
    }
    lines.push('');
  }

  // Groups (name + file count only)
  const groups = parsed.groups ?? [];
  if (groups.length > 0) {
    lines.push(`=== Groups (${groups.length}) ===`);
    for (const g of groups) {
      lines.push(`- ${g.name ?? 'unnamed'}: ${g.file_count ?? 0} files`);
    }
    lines.push('');
  }

  lines.push('--- End of OCR Review ---');
  return lines.join('\n');
}

// ============================================================================
// createOcrReviewTool — registers the "co_ocr_review" tool with OpenCode
// ============================================================================

/**
 * Create the `co_ocr_review` tool definition.
 *
 * Provides optional integration with the local @alibaba-group/open-code-review CLI.
 * Soft dependency: if OCR is not installed, returns a guidance string.
 * Only the co-oracle agent is allowed to invoke this tool.
 *
 * @param ctx           Plugin input
 * @param projectDir    Project root directory (used as --repo)
 * @param ocrAvailable  Whether the OCR CLI is installed (from detectOcrCli)
 */
export function createOcrReviewTool(
  ctx: PluginInput,
  projectDir: string,
  ocrAvailable: boolean,
): Record<string, ReturnType<typeof tool>> {
  const co_ocr_review = tool({
    description: [
      'Run @alibaba-group/open-code-review for structured code review.',
      '',
      'Invokes the local OCR CLI to perform a structured code review of the git diff.',
      'Returns formatted results with comments, warnings, and summary.',
      '',
      'Soft dependency: if OCR is not installed, returns installation guidance.',
    ].join('\n'),

    args: {
      from: z.string().describe(
        '起始 git 引用（branch/tag/commit），例如 "main"、"HEAD~10"',
      ),
      to: z.string().optional().describe(
        '结束 git 引用，默认 HEAD',
      ),
      background: z.string().optional().describe(
        '业务上下文说明，例如 "这是一个支付模块的重构 PR"',
      ),
      preview: z.boolean().optional().describe(
        '仅列出待审文件、不调用 LLM（零 token），默认 true；确认真实审查时显式传 false',
      ),
    },

    async execute(
      args: { from: string; to?: string; background?: string; preview?: boolean },
      toolContext: { sessionID: string; agent: string },
    ): Promise<string> {
      // ① Permission check: only co-oracle may call this
      if (toolContext.agent && toolContext.agent !== 'co-oracle') {
        throw new Error(
          `co_ocr_review 仅限 co-oracle 调用。当前 agent: ${toolContext.agent}`,
        );
      }

      // ② Soft dependency degradation (must NOT throw)
      if (!ocrAvailable) {
        return [
          '【CoHub】OCR CLI（@alibaba-group/open-code-review）未安装，已跳过外部审查。',
          '安装：npm install -g @alibaba-group/open-code-review',
          '验证：ocr version',
          '安装后需重启 OpenCode 方可生效。',
          '本次请回退到 co-oracle 原生方式（并行读取文件 + 结构化报告）。',
        ].join('\n');
      }

      // ③ Build args and execute
      const cliArgs = buildOcrArgs(
        {
          from: args.from,
          to: args.to,
          background: args.background,
          preview: args.preview,
        },
        projectDir,
      );

      const result = await executeOcrReview(cliArgs, projectDir);

      // Spawn failure (ENOENT or similar)
      if (result.exitCode === null) {
        return `【CoHub】OCR CLI 执行失败：${result.stderr}`;
      }

      // Non-zero exit code
      if (!result.success) {
        const stderrSummary =
          result.stderr.length > 500
            ? result.stderr.slice(0, 500) + '...（截断）'
            : result.stderr;
        return [
          '【CoHub】OCR CLI 返回错误：',
          `Exit code: ${result.exitCode}`,
          `Stderr: ${stderrSummary}`,
          '',
          '请检查 OCR CLI 配置或回退到 co-oracle 原生方式。',
        ].join('\n');
      }

      // ④ Format output with truncation
      let output = formatOcrOutput(result.stdout);
      if (result.truncated) {
        output += '\n\n[警告] OCR 输出超过 10MB 限制，stdout 已被截断。';
      }
      return output;
    },
  });

  return { co_ocr_review };
}