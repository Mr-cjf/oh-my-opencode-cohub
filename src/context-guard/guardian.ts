/** 上下文卫士 - Guardian 分析模块 */
import type { GuardianRecommendation, GuardOption } from './types';
import { setCachedRecommendation } from './state';
import { estimateTokens } from './token-counter';

/**
 * 分析会话状态，返回三选一推荐。
 *
 * @experimental 当前使用启发式分析。
 *   后续计划：接入 co-guardian 子代理做基于 LLM 的深度分析。
 */
export function analyzeSession(
  sessionID: string,
  messages: Array<{ role: string; content: string }>,
): GuardianRecommendation {
  const rec = heuristicAnalyze(messages);
  setCachedRecommendation(sessionID, rec);
  return rec;
}

/**
 * 从 messages.transform 的 output.messages 中提取最近消息摘要
 * 供 analyzeSession 使用
 */
export function extractRecentMessages(
  messages: Array<Record<string, unknown>>,
  maxCount = 30,
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];
  const startIdx = Math.max(0, messages.length - maxCount);

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;
    const info = msg.info as Record<string, unknown> | undefined;
    const role = typeof info?.role === 'string' ? info.role : 'unknown';
    const parts = msg.parts as Array<Record<string, unknown>> | undefined;
    let content = '';
    if (parts) {
      for (const part of parts) {
        if (part.type === 'text' && typeof part.text === 'string') {
          content += part.text.slice(0, 500) + ' ';
        }
      }
    }
    if (content.trim()) {
      // 按 token 截断，避免单条消息过长
      const truncated = truncateByTokens(content.trim(), 800);
      result.push({ role, content: truncated });
    }
  }
  return result;
}

/**
 * 按 token 数截断文本
 */
function truncateByTokens(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;
  // 粗略按比例截断
  const ratio = maxTokens / estimated;
  return text.slice(0, Math.floor(text.length * ratio)) + '...';
}

/**
 * 启发式分析（基于会话模式给出推荐）
 */
function heuristicAnalyze(
  messages: Array<{ role: string; content: string }>,
): GuardianRecommendation {
  let errorCount = 0;
  let taskKeywords = 0;
  let decisionKeywords = 0;

  const errorPatterns = /error|错误|失败|fail|bug|问题|exception/i;
  const taskPatterns = /完成|done|finish|结束|final|最后/i;
  const decisionPatterns = /决定|采用|选择|使用|方案|架构|设计/i;

  for (const msg of messages) {
    if (errorPatterns.test(msg.content)) errorCount++;
    if (taskPatterns.test(msg.content)) taskKeywords++;
    if (decisionPatterns.test(msg.content)) decisionKeywords++;
  }

  const totalMessages = messages.length || 1;
  const errorRate = errorCount / totalMessages;
  const taskCompleteRate = taskKeywords / totalMessages;

  if (errorRate > 0.3) {
    return {
      option: 'migrate',
      confidence: 0.7,
      reasoning: `会话中错误出现频率较高（${(errorRate * 100).toFixed(0)}%），建议提取关键上下文后在新会话中继续，以减少错误累积。`,
      alternatives: '如错误已解决，可选择"自动压缩"保留当前上下文继续。',
    };
  }

  if (taskCompleteRate > 0.15) {
    return {
      option: 'session-compact',
      confidence: 0.65,
      reasoning: '对话中出现较多完成/结束相关讨论，任务可能接近收尾阶段，建议压缩会话后快速完成。',
      alternatives: '如需保留详细上下文继续工作，可选择"自动压缩"。',
    };
  }

  return {
    option: 'auto-compact' as GuardOption,
    confidence: 0.6,
    reasoning: '当前对话连续性较好，建议压缩旧消息保留最近上下文，继续当前任务。',
    alternatives: '如会话内容混乱或需要整理，建议"分析迁移"。',
  };
}
