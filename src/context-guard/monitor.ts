/** 上下文卫士 - Token 监控器 */
import type { PluginInput } from '@opencode-ai/plugin';
import { estimateTokens, computeContextUsage, isOverThreshold } from './token-counter';
import { getSessionState, canTrigger, markTriggered, decrementCooldown } from './state';
import { DEFAULT_GUARD_CONFIG } from './types';
import type { ContextGuardConfig, ContextUsage } from './types';

/** 触发事件（返回值，不再修改 SDK 对象） */
export interface TriggerEvent {
  sessionID: string;
  usedTokens: number;
  contextLimit: number;
}

/** 已计数的消息 ID（防重复累加） */
const countedMessages = new Map<string, Set<string>>();

/** 全局模型上下文缓存 */
let modelContext: { providerId?: string; modelId?: string; contextLimit: number } = {
  contextLimit: 200_000, // 默认 200K
};

/**
 * chat.params hook 处理器：捕获模型上下文窗口大小
 */
export function createChatParamsHandler() {
  return async (input: PluginInput): Promise<void> => {
    try {
      const model = (input as Record<string, unknown>).model as Record<string, unknown> | undefined;
      if (model?.limit) {
        const limit = model.limit as Record<string, unknown>;
        if (typeof limit.context === 'number') {
          modelContext.contextLimit = limit.context;
        }
      }
      const params = (input as Record<string, unknown>).params as Record<string, unknown> | undefined;
      if (params?.model) {
        const m = params.model as Record<string, unknown>;
        if (m?.limit && typeof (m.limit as Record<string, unknown>).context === 'number') {
          modelContext.contextLimit = (m.limit as Record<string, unknown>).context as number;
        }
      }
    } catch { /* 静默失败 */ }
  };
}

/**
 * event hook 处理器：监听 message.updated 事件，检测 token 阈值
 *
 * 返回值模式：通过返回 TriggerEvent 通知调用方，不再修改 SDK 事件对象。
 * 参考 context-compress 的事件驱动架构。
 */
export function createEventHandler(config?: Partial<ContextGuardConfig>) {
  const cfg = { ...DEFAULT_GUARD_CONFIG, ...config };

  return async (input: PluginInput): Promise<TriggerEvent | null> => {
    if (!cfg.enabled) return null;

    try {
      const event = (input as Record<string, unknown>).event as Record<string, unknown> | undefined;
      if (!event || event.type !== 'message.updated') return null;

      const properties = event.properties as Record<string, unknown> | undefined;
      if (!properties) return null;

      const info = properties.info as Record<string, unknown> | undefined;
      // 只监听 assistant 消息完成后
      if (info?.role !== 'assistant') return null;
      if (!info.time || !(info.time as Record<string, unknown>).completed) return null;
      // 跳过 summary 消息（compaction 结果）
      if (info.summary) return null;

      // SDK 的 EventMessageUpdated.properties 只有 info 字段，sessionID 在 info 中
      const sessionID = info.sessionID as string | undefined;
      if (!sessionID) return null;

      // 获取 session 状态
      const state = getSessionState(sessionID);

      // 冷却递减
      if (state.cooldownRemaining > 0) {
        decrementCooldown(state);
      }

      const messageId = info.id as string | undefined;
      if (!messageId) return null;

      // 检查是否可以触发
      if (!canTrigger(state, messageId)) return null;

      // 提取 token 用量（SDK 的 AssistantMessage.tokens 只有 input/output/reasoning/cache，无 total 字段）
      const tokens = info.tokens as Record<string, unknown> | undefined;
      const inputTokens = typeof tokens?.input === 'number' ? tokens.input : undefined;
      const outputTokens = typeof tokens?.output === 'number' ? tokens.output : undefined;
      const reasoningTokens = typeof tokens?.reasoning === 'number' ? tokens.reasoning : undefined;
      let totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0) + (reasoningTokens ?? 0);

      // 防御：如果 SDK 未提供 total，用自维护累计值兜底
      if (totalTokens <= 0) {
        totalTokens = state.cumulativeTokens;
      }

      // 累积 token（每条 message.updated 的 tokens 是增量，需累加而非覆盖）
      // 去重：同一条消息可能在会话加载时重播事件
      if (!countedMessages.get(sessionID)?.has(messageId)) {
        state.cumulativeTokens += totalTokens;
        if (!countedMessages.has(sessionID)) countedMessages.set(sessionID, new Set());
        countedMessages.get(sessionID)!.add(messageId);
      }

      // 回退：如果所有来源都无效，从消息内容估算
      let estimatedTotal = totalTokens;
      if (estimatedTotal <= 0) {
        const messages = properties.messages;
        if (Array.isArray(messages)) {
          for (const msg of messages) {
            const content = (msg as Record<string, unknown>).content;
            if (typeof content === 'string') {
              estimatedTotal += estimateTokens(content);
            }
          }
        }
      }

      if (estimatedTotal <= 0) return null;

      // 计算使用率
      const usage = computeContextUsage(
        estimatedTotal,
        modelContext.contextLimit,
        inputTokens,
        outputTokens,
        reasoningTokens,
      );

      // 检查阈值
      if (!isOverThreshold(usage, cfg.triggerRatio, cfg.tokenThreshold)) return null;

      // 触发！
      markTriggered(state, messageId, estimatedTotal, modelContext.contextLimit);

      // ✅ 通过返回值传递触发信息，不再修改 SDK 对象
      return { sessionID, usedTokens: estimatedTotal, contextLimit: modelContext.contextLimit };

    } catch (err) {
      if (cfg.debug) console.warn('[context-guard] monitor error:', err);
      return null;
    }
  };
}

/** 获取当前上下文限制 */
export function getContextLimit(): number {
  return modelContext.contextLimit;
}

/** 清理已计数消息缓存（dispose 时调用） */
export function cleanupCountedMessages(): void {
  countedMessages.clear();
}
