// src/context/extractor.ts — 从父 session 消息中提取结构化信息

import type { RelevantFile } from './types';

/** SDK v2 消息格式（简化） */
interface SdkMessage {
  info?: { role?: string };
  parts?: Array<{ type?: string; text?: string; tool?: string; args?: unknown; tool_result?: unknown }>;
}

/**
 * 从消息列表中提取相关文件。
 * 扫描 Read/Edit/Write/Glob/Grep 工具调用和 tool_result 中的路径。
 */
export function extractRelevantFiles(
  messages: SdkMessage[],
  maxFiles: number,
  windowSize: number,
): RelevantFile[] {
  const recent = messages.slice(-windowSize);
  const fileMap = new Map<string, RelevantFile>();

  for (const msg of recent) {
    for (const part of msg.parts ?? []) {
      // 从工具调用中提取路径
      if (part.type === 'tool_call' && part.args) {
        const args = part.args as Record<string, unknown>;
        const path = extractPath(args);
        if (path && !fileMap.has(path)) {
          fileMap.set(path, { path, summary: '' });
        }
      }
      // 从工具结果中提取路径和内容摘要
      if (part.type === 'tool_result' && part.tool_result) {
        const tr = part.tool_result as Record<string, unknown>;
        const path = extractPath(tr);
        if (path && fileMap.has(path)) {
          const existing = fileMap.get(path)!;
          // 尝试提取行号范围
          const args = tr.args as Record<string, unknown> | undefined;
          if (args) {
            if (typeof args.offset === 'number') {
              const limit = typeof args.limit === 'number' ? args.limit : 50;
              existing.lines = `${args.offset}-${args.offset + limit}`;
            }
            if (typeof args.oldString === 'string') {
              existing.summary = `编辑位置: ${args.oldString.slice(0, 80)}`;
            }
          }
          if (!existing.summary && typeof tr.output === 'string') {
            existing.summary = tr.output.slice(0, 100).replace(/\n/g, ' ');
          }
        }
      }
    }
  }

  return Array.from(fileMap.values()).slice(0, maxFiles);
}

function extractPath(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.filePath === 'string') return obj.filePath;
  if (typeof obj.path === 'string') return obj.path;
  if (typeof obj.file === 'string') return obj.file;
  if (typeof obj.filepath === 'string') return obj.filepath;
  return undefined;
}

/**
 * 从 assistant 消息中提取关键决策。
 * 匹配包含决策关键词的句子。
 */
export function extractDecisions(
  messages: SdkMessage[],
  maxDecisions: number,
  windowSize: number,
): string[] {
  const recent = messages.slice(-windowSize);
  const decisions: string[] = [];
  const keywords = /(认定|决定|确认|方案是|结论|应该|不建议|必须|禁止|采用)/;

  for (const msg of recent) {
    if (msg.info?.role !== 'assistant') continue;
    for (const part of msg.parts ?? []) {
      if (part.type !== 'text' || !part.text) continue;
      const sentences = part.text.split(/[。！？\n]/);
      for (const s of sentences) {
        const trimmed = s.trim();
        if (trimmed.length > 10 && trimmed.length < 200 && keywords.test(trimmed)) {
          decisions.push(trimmed);
          if (decisions.length >= maxDecisions) return decisions;
        }
      }
    }
  }

  return decisions;
}

/**
 * 从 bash 输出中提取编译/测试错误。
 */
export function extractErrors(
  messages: SdkMessage[],
  maxErrors: number,
  windowSize: number,
): string[] {
  const recent = messages.slice(-windowSize);
  const errors: string[] = [];
  const errorPatterns = /(error|Error|TypeError|ReferenceError|SyntaxError|RangeError|FAIL|failed|cannot find|cannot resolve|not found|unexpected token)/;

  for (const msg of recent) {
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool_result' || !part.tool_result) continue;
      const tr = part.tool_result as Record<string, unknown>;
      const output = typeof tr.output === 'string' ? tr.output : '';
      if (!output) continue;
      const lines = output.split('\n');
      for (const line of lines) {
        if (errorPatterns.test(line) && line.length < 300) {
          errors.push(line.trim());
          if (errors.length >= maxErrors) return errors;
        }
      }
    }
  }

  return errors;
}
