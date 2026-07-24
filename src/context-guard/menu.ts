/** 上下文卫士 - 菜单注入 */
import type { PluginInput } from '@opencode-ai/plugin';
import { renderGuardMenu } from './prompts';
import { getSessionState, setSelectedOption, getCachedRecommendation } from './state';
import type { GuardOption } from './types';
import { executeAutoCompress } from './options/auto-compress';
import { executeSessionCompact } from './options/session-compact';
import { executeMigrate } from './options/migrate';
import { analyzeSession, extractRecentMessages } from './guardian';

/** 待注入的上下文使用信息（按 sessionId 隔离，防止多会话竞态） */
const pendingUsages = new Map<string, { usedTokens: number; contextLimit: number }>();

export function setPendingUsage(sessionID: string, usage: { usedTokens: number; contextLimit: number }): void {
  pendingUsages.set(sessionID, usage);
}

/**
 * 从消息列表中找到最后一条 user 消息及其 sessionID
 */
function findLastUserMessage(
  messages: Array<Record<string, unknown>>,
): { msg: Record<string, unknown>; sessionID: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const info = m.info as Record<string, unknown> | undefined;
    if (info?.role === 'user') {
      const sid = (info.sessionID as string) || (info.sessionId as string);
      if (sid) return { msg: m, sessionID: sid };
    }
  }
  return null;
}

/**
 * messages.transform hook 处理器：注入三选一菜单 + Guardian 分析
 */
export function createMessagesTransformHandler() {
  return async (_input: PluginInput, output: { messages?: Array<Record<string, unknown>> }): Promise<void> => {
    try {
      if (!output.messages || !Array.isArray(output.messages)) return;

      const found = findLastUserMessage(output.messages);
      if (!found) return;

      const usage = pendingUsages.get(found.sessionID);
      if (!usage) return;
      pendingUsages.delete(found.sessionID); // 消费即删除

      // Guardian 分析（从当前消息中提取摘要）
      const recentMsgs = extractRecentMessages(output.messages, 30);
      const recommendation = analyzeSession(found.sessionID, recentMsgs);

      // 生成菜单
      const menu = renderGuardMenu(usage.usedTokens, usage.contextLimit, recommendation);

      // 注入到消息末尾
      const parts = found.msg.parts as Array<Record<string, unknown>> | undefined;
      if (parts) {
        for (let j = parts.length - 1; j >= 0; j--) {
          if (parts[j].type === 'text') {
            parts[j].text = (parts[j].text as string || '') + '\n\n' + menu;
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[context-guard] menu injection error:', err);
    }
  };
}

/**
 * 解析用户选项选择（精确匹配，避免"不想自动压缩"误触发）
 */
function parseOption(text: string): GuardOption | undefined {
  const t = text.trim();
  // 纯数字（含全角）
  if (t === '1' || t === '１') return 'auto-compress';
  if (t === '2' || t === '２') return 'session-compact';
  if (t === '3' || t === '３') return 'migrate';
  // 精确指令匹配（必须以"选1"或"1、"等形式开头）
  if (/^[选1１]\s*[.、,，]?\s*(自动压缩|选项1)/.test(t)) return 'auto-compress';
  if (/^[选2２]\s*[.、,，]?\s*(会话压缩|compact|选项2)/i.test(t)) return 'session-compact';
  if (/^[选3３]\s*[.、,，]?\s*(分析迁移|迁移|选项3)/.test(t)) return 'migrate';
  // 仅包含关键词的短消息也接受
  if (t === '自动压缩') return 'auto-compress';
  if (t === '会话压缩') return 'session-compact';
  if (t === '分析迁移') return 'migrate';
  return undefined;
}

/**
 * chat.message hook 处理器：拦截用户选项选择
 */
export function createChatMessageHandler() {
  return async (
    input: PluginInput,
    output: { message?: Record<string, unknown>; parts?: Array<Record<string, unknown>> },
  ): Promise<void> => {
    try {
      // 从 output.parts 读取用户输入文本（SDK 在 hook 返回后读取修改后的 output）
      const rawInput = input as Record<string, unknown>;
      const sessionID = rawInput.sessionID as string | undefined;
      if (!sessionID) return;

      const state = getSessionState(sessionID);
      if (!state.triggered) return; // 未触发菜单，忽略

      let userText = '';
      if (output.parts) {
        for (const part of output.parts) {
          if (part.type === 'text' && typeof part.text === 'string') {
            userText = (part.text as string);
          }
        }
      }

      const option = parseOption(userText);
      if (!option) return;

      // 标记用户选择
      setSelectedOption(state, option);

      // 执行对应操作
      let replyText = '';
      switch (option) {
        case 'auto-compress':
          replyText = executeAutoCompress(sessionID);
          break;
        case 'session-compact':
          replyText = executeSessionCompact();
          break;
        case 'migrate':
          replyText = await executeMigrate(sessionID, []);
          break;
      }

      // ✅ SDK 正确的做法：直接修改 output.parts（引用传递），运行时在 hook 返回后读取
      if (output.parts) {
        output.parts.length = 0;
        output.parts.push({ type: 'text', text: replyText });
      }

    } catch (err) {
      console.warn('[context-guard] chat.message error:', err);
    }
  };
}
