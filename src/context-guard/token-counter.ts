/** 上下文卫士 - Token 计数器 */
import type { ContextUsage } from './types';

/** 字符-token 换算系数 */
const CHARS_PER_TOKEN_EN = 3.7;     // 英文/拉丁字符
const CHARS_PER_TOKEN_CODE = 3.2;   // 代码文本
const CHARS_PER_TOKEN_CJK = 1.8;    // 中文/日文/韩文 (~1.5-2 chars/token)

/** CJK 字符正则 */
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g;

/**
 * 启发式 token 估算（字符法，无外部依赖）
 * 针对 CJK 字符使用更准确的系数，避免对中文文本严重低估
 * 综合准确率 ~85-90%
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  // 分离 CJK 字符和其余文本
  const cjkCount = (text.match(CJK_REGEX) ?? []).length;
  const nonCjkText = text.replace(CJK_REGEX, '');

  // 在非 CJK 文本中检测代码特征
  const codeIndicators = (nonCjkText.match(/[{}\[\];=<>()|&!+\-*/]/g) ?? []).length;
  const codeRatio = codeIndicators / (nonCjkText.length || 1);
  const charsPerToken = codeRatio > 0.05 ? CHARS_PER_TOKEN_CODE : CHARS_PER_TOKEN_EN;

  return Math.ceil(cjkCount / CHARS_PER_TOKEN_CJK + nonCjkText.length / charsPerToken);
}

/**
 * 从消息数组中估算 token 用量
 */
export function estimateMessagesTokens(messages: Array<{ content?: string }>): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.content && typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    }
  }
  return total;
}

/**
 * 计算上下文使用统计
 */
export function computeContextUsage(
  usedTokens: number,
  contextLimit: number,
  inputTokens?: number,
  outputTokens?: number,
  reasoningTokens?: number,
): ContextUsage {
  return {
    usedTokens,
    contextLimit,
    ratio: contextLimit > 0 ? usedTokens / contextLimit : 0,
    inputTokens,
    outputTokens,
    reasoningTokens,
  };
}

/**
 * 判断是否超过阈值
 * triggerRatio: 上下文窗口已使用比例（默认 0.2 = 20%）
 * tokenThreshold: 绝对 token 数阈值（兜底）
 * 两个条件满足其一即触发
 */
export function isOverThreshold(usage: ContextUsage, triggerRatio: number, tokenThreshold: number): boolean {
  return usage.ratio >= triggerRatio || usage.usedTokens >= tokenThreshold;
}
