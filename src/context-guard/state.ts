/** 上下文卫士 - 会话状态管理 */
import type { GuardSessionState, GuardOption, GuardianRecommendation } from './types';
import { DEFAULT_GUARD_CONFIG } from './types';

/** 内存状态存储（按 sessionId 索引） */
const sessionStates = new Map<string, GuardSessionState>();

/** Session 生存时间：1 小时无活动自动清理 */
const SESSION_TTL_MS = 60 * 60 * 1000;

/** Guardian 推荐缓存（按 sessionId 隔离） */
const recommendations = new Map<string, GuardianRecommendation>();

/**
 * 创建新会话状态
 */
export function createSessionState(sessionId: string): GuardSessionState {
  const state: GuardSessionState = {
    sessionId,
    triggered: false,
    cooldownRemaining: 0,
    cumulativeTokens: 0,
    lastAccessTime: Date.now(),
  };
  sessionStates.set(sessionId, state);
  return state;
}

/**
 * 获取或创建会话状态，同时更新最后访问时间
 */
export function getSessionState(sessionId: string): GuardSessionState {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = createSessionState(sessionId);
  }
  state.lastAccessTime = Date.now();
  return state;
}

/**
 * 检查是否可以触发三选一
 * 条件：未触发过 + 冷却期已过 + 不是同一个触发消息
 */
export function canTrigger(state: GuardSessionState, messageId: string): boolean {
  if (state.triggered) return false;
  if (state.cooldownRemaining > 0) return false;
  if (state.lastTriggerMessageId === messageId) return false;
  return true;
}

/**
 * 标记已触发
 */
export function markTriggered(state: GuardSessionState, messageId: string, tokens?: number, contextLimit?: number): void {
  state.triggered = true;
  state.lastTriggerMessageId = messageId;
  state.triggerTokens = tokens;
  state.triggerContextLimit = contextLimit;
}

/**
 * 设置用户选择
 */
export function setSelectedOption(state: GuardSessionState, option: GuardOption): void {
  state.selectedOption = option;
}

/**
 * 设置冷却期（压缩完成后调用）
 */
export function setCooldown(state: GuardSessionState, afterMessageId: string): void {
  state.cooldownAfterMessageId = afterMessageId;
  state.cooldownRemaining = DEFAULT_GUARD_CONFIG.cooldownTurns;
}

/**
 * 减少冷却轮次（每轮 assistant 回复后调用）
 */
export function decrementCooldown(state: GuardSessionState): void {
  if (state.cooldownRemaining > 0) {
    state.cooldownRemaining--;
  }
  if (state.cooldownRemaining <= 0) {
    state.triggered = false;
    state.selectedOption = undefined;
  }
}

/**
 * 重置会话状态
 */
export function resetSessionState(sessionId: string): void {
  sessionStates.delete(sessionId);
  recommendations.delete(sessionId);
  createSessionState(sessionId);
}

/**
 * 缓存 Guardian 推荐（按 sessionId 隔离）
 */
export function setCachedRecommendation(sessionID: string, rec: GuardianRecommendation): void {
  recommendations.set(sessionID, rec);
}

/**
 * 获取缓存的 Guardian 推荐
 */
export function getCachedRecommendation(sessionID: string): GuardianRecommendation | undefined {
  return recommendations.get(sessionID);
}

/**
 * 清理过期 session 状态（超过 TTL 无访问）
 */
export function cleanupStaleSessions(): void {
  const now = Date.now();
  for (const [id, state] of sessionStates) {
    if (now - state.lastAccessTime > SESSION_TTL_MS) {
      sessionStates.delete(id);
      recommendations.delete(id);
    }
  }
}

/**
 * 清理所有状态（插件 dispose 时调用）
 */
export function cleanupAllStates(): void {
  sessionStates.clear();
  recommendations.clear();
}
