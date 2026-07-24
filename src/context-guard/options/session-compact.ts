/** 上下文卫士 - 选项2：会话压缩 */
import { SESSION_COMPACT_GUIDE } from '../prompts';

/**
 * 执行会话压缩：引导用户触发 OpenCode 内置 Compact Session
 */
export function executeSessionCompact(): string {
  // 引导用户手动触发 compact（Ctrl+K → Compact Session）
  return SESSION_COMPACT_GUIDE;
}
