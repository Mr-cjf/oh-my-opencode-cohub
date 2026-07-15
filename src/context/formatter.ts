// src/context/formatter.ts — 将 TaskContext 格式化为注入用的 Markdown

import type { TaskContext } from './types';

/** 上下文标记正则 — 用于在 messages.transform 中匹配 */
export const CONTEXT_MARKER_PATTERN = /<!-- CONTEXT:ID=([a-f0-9-]+) -->/;

/** 生成上下文标记文本 */
export function formatContextMarker(contextId: string): string {
  return `\n\n<!-- CONTEXT:ID=${contextId} -->`;
}

/**
 * 将 TaskContext 格式化为注入到子代理 user 消息中的 Markdown 块。
 */
export function formatTaskContext(context: TaskContext): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('### 📋 任务上下文 (CoHub 自动注入)');
  lines.push('');

  if (context.goal) {
    lines.push(`**当前任务**: ${context.goal}`);
    lines.push('');
  }

  if (context.relevantFiles.length > 0) {
    lines.push('**相关文件**:');
    lines.push('| 文件 | 说明 |');
    lines.push('|------|------|');
    for (const f of context.relevantFiles) {
      const loc = f.lines ? `:${f.lines}` : '';
      lines.push(`| \`${f.path}${loc}\` | ${f.summary || '-'} |`);
    }
    lines.push('');
  }

  if (context.decisions.length > 0) {
    lines.push('**前置决策**:');
    for (let i = 0; i < context.decisions.length; i++) {
      lines.push(`${i + 1}. ${context.decisions[i]}`);
    }
    lines.push('');
  }

  if (context.dependencies.length > 0) {
    lines.push('**依赖结果**:');
    for (const d of context.dependencies) {
      lines.push(`- \`${d.alias}\` (${d.agent}): ${d.keyOutput}`);
    }
    lines.push('');
  }

  if (context.errors.length > 0) {
    lines.push('**错误信息**:');
    for (const e of context.errors) {
      lines.push(`- \`${e}\``);
    }
    lines.push('');
  }

  lines.push('<!-- CONTEXT:END -->');
  return lines.join('\n');
}

/**
 * 将标记替换为格式化的上下文块。
 * 返回替换后的完整消息文本，或 null（如果未找到标记）。
 */
export function replaceMarkerWithContext(messageText: string, context: TaskContext): string | null {
  const match = messageText.match(CONTEXT_MARKER_PATTERN);
  if (!match) return null;

  const formatted = formatTaskContext(context);
  return messageText.replace(CONTEXT_MARKER_PATTERN, formatted);
}
