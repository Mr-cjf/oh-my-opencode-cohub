// src/context/strategy.ts — 上下文策略解析

import type { ContextStrategy } from './types';

/**
 * 解析子代理的上下文策略。
 * 优先级：task 覆盖参数 > 代理默认配置 > 'none'
 */
export function resolveStrategy(
  agentType: string,
  defaults: Record<string, ContextStrategy>,
  override?: ContextStrategy,
): ContextStrategy {
  if (override) return override;
  return defaults[agentType] ?? 'none';
}
