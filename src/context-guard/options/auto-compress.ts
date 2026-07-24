/** 上下文卫士 - 选项1：自动压缩 */
import { estimateTokens, estimateMessagesTokens } from '../token-counter';
import { AUTO_COMPRESS_DONE } from '../prompts';
import { getSessionState, setCooldown } from '../state';

/**
 * 执行自动压缩：将旧消息替换为摘要占位符
 * 当前简化实现：输出确认信息，实际压缩在 messages.transform 中完成
 */
export function executeAutoCompress(sessionID: string): string {
  const state = getSessionState(sessionID);

  // 设置冷却期
  setCooldown(state, 'auto-compress');

  // 实际压缩逻辑由 options/auto-compress 在 transform 中执行
  return AUTO_COMPRESS_DONE;
}

/**
 * 生成压缩占位符消息
 */
export function createCompressionPlaceholder(
  originalContent: string,
  role: string,
): string {
  const estimatedTokens = estimateTokens(originalContent);
  const preview = originalContent.slice(0, 100).replace(/\n/g, ' ');
  return `📦 [已压缩 ${role} 消息] ${preview}... (约 ${estimatedTokens} tokens)`;
}
