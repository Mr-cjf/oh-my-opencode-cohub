import type { TaskContext } from './types';
/** 上下文标记正则 — 用于在 messages.transform 中匹配 */
export declare const CONTEXT_MARKER_PATTERN: RegExp;
/** 生成上下文标记文本 */
export declare function formatContextMarker(contextId: string): string;
/**
 * 将 TaskContext 格式化为注入到子代理 user 消息中的 Markdown 块。
 */
export declare function formatTaskContext(context: TaskContext): string;
/**
 * 将标记替换为格式化的上下文块。
 * 返回替换后的完整消息文本，或 null（如果未找到标记）。
 */
export declare function replaceMarkerWithContext(messageText: string, context: TaskContext): string | null;
//# sourceMappingURL=formatter.d.ts.map