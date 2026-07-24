/** 上下文卫士 - 插件入口 */
import { createEventHandler, createChatParamsHandler, type TriggerEvent } from './monitor';
import { createMessagesTransformHandler, createChatMessageHandler, setPendingUsage } from './menu';
import { DEFAULT_GUARD_CONFIG } from './types';
import { cleanupStaleSessions } from './state';
import type { ContextGuardConfig } from './types';

let config: ContextGuardConfig = { ...DEFAULT_GUARD_CONFIG };

/**
 * 初始化上下文卫士
 * 返回需要注册到插件的 hooks 对象
 */
export function initContextGuard(_client: unknown) {
  const eventHandler = createEventHandler(config);
  const paramsHandler = createChatParamsHandler();
  const transformHandler = createMessagesTransformHandler();
  const chatMessageHandler = createChatMessageHandler();

  /**
   * 触发处理：设置待注入的使用信息
   * Guardian 分析由 messages.transform 中异步执行
   */
  async function handleTrigger(trigger: TriggerEvent) {
    setPendingUsage(trigger.sessionID, {
      usedTokens: trigger.usedTokens,
      contextLimit: trigger.contextLimit,
    });
  }

  return {
    /** 更新配置 */
    updateConfig(newConfig: Partial<ContextGuardConfig>) {
      config = { ...config, ...newConfig };
    },

    /** event hook：监控 token 用量，返回 TriggerEvent 而非修改 SDK 对象 */
    event: async (input: unknown) => {
      const trigger = await eventHandler(input as Parameters<typeof eventHandler>[0]);
      if (trigger) {
        await handleTrigger(trigger);
      }
    },

    /** chat.params hook：捕获上下文窗口大小 */
    'chat.params': async (input: unknown) => {
      await paramsHandler(input as Parameters<typeof paramsHandler>[0]);
    },

    /** messages.transform hook：注入三选一菜单 + Guardian 分析 */
    'experimental.chat.messages.transform': async (input: unknown, output: unknown) => {
      await transformHandler(
        input as Parameters<typeof transformHandler>[0],
        output as Parameters<typeof transformHandler>[1],
      );
    },

    /** chat.message hook：拦截用户选择，通过 output.parts 变异注入回复 */
    'chat.message': async (input: unknown, output: unknown) => {
      await chatMessageHandler(
        input as Parameters<typeof chatMessageHandler>[0],
        output as Parameters<typeof chatMessageHandler>[1],
      );
    },

    getConfig: () => config,
  };
}

export { type ContextGuardConfig, DEFAULT_GUARD_CONFIG } from './types';
export { cleanupStaleSessions } from './state';
