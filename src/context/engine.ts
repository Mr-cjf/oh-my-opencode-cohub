// src/context/engine.ts — 上下文引擎核心

import type { ContextStrategy, TaskContext, ContextConfig, DependencyResult } from './types';
import { DEFAULT_CONTEXT_CONFIG } from './types';
import { extractRelevantFiles, extractDecisions, extractErrors } from './extractor';
import { formatContextMarker, replaceMarkerWithContext, CONTEXT_MARKER_PATTERN } from './formatter';
import type { createOpencodeClient } from '@opencode-ai/sdk';

type SdkClient = ReturnType<typeof createOpencodeClient>;

export class ContextEngine {
  /** contextId → TaskContext */
  private registry = new Map<string, TaskContext>();
  /** alias → 前置子代理结果 */
  private dependencyCache = new Map<string, DependencyResult>();
  private client: SdkClient;
  private config: ContextConfig;

  constructor(client: SdkClient, config?: Partial<ContextConfig>) {
    this.client = client;
    // 修复 I2: 深度合并 strategy
    this.config = {
      ...DEFAULT_CONTEXT_CONFIG,
      ...config,
      strategy: { ...DEFAULT_CONTEXT_CONFIG.strategy, ...config?.strategy },
    };
  }

  /**
   * 同步注册上下文占位并返回 contextId。
   * 标记可立即注入到 output.args.description。
   */
  registerContext(args: { description: string }): string {
    const contextId = crypto.randomUUID();
    this.registry.set(contextId, {
      goal: args.description,
      relevantFiles: [],
      decisions: [],
      errors: [],
      dependencies: [],
    });
    return contextId;
  }

  /**
   * 异步填充已注册的上下文（不阻塞工具启动）。
   */
  async fillContextAsync(
    contextId: string,
    parentSessionId: string,
    args: { strategy: ContextStrategy },
  ): Promise<void> {
    const context = this.registry.get(contextId);
    if (!context) return;

    if (args.strategy === 'none') return;

    try {
      const windowSize = this.config.relevantMessageWindow;
      const messagesResult = await this.client.session.messages({
        path: { id: parentSessionId },
        query: { limit: windowSize },
      });
      const messages = (messagesResult.data ?? []) as Array<{
        info?: { role?: string };
        parts?: Array<{ type?: string; text?: string; tool?: string; args?: unknown; tool_result?: unknown }>;
      }>;

      if (args.strategy === 'relevant' || args.strategy === 'summary' || args.strategy === 'full') {
        context.relevantFiles = extractRelevantFiles(messages, this.config.maxFiles, windowSize);
        context.decisions = extractDecisions(messages, this.config.maxDecisions, windowSize);
        context.errors = extractErrors(messages, this.config.maxErrors, windowSize);
      }

      if (this.config.dependencyPropagation && this.dependencyCache.size > 0) {
        context.dependencies = Array.from(this.dependencyCache.values())
          .slice(-this.config.maxDependencies);
      }
    } catch {
      // SDK 调用失败时保留最小上下文
    }
  }

  /**
   * Phase B: 消费标记文本。
   * 从消息文本中提取 contextId → 查 registry → 替换标记为格式化上下文。
   * 返回替换后的完整文本，或 null（无标记或未找到上下文）。
   */
  consumeMarkedContext(messageText: string): string | null {
    const markerMatch = messageText.match(CONTEXT_MARKER_PATTERN);
    if (!markerMatch) return null;

    const contextId = markerMatch[1];
    const context = this.registry.get(contextId);
    if (!context) {
      // 上下文已过期或被清理，移除标记
      return messageText.replace(CONTEXT_MARKER_PATTERN, '');
    }

    const result = replaceMarkerWithContext(messageText, context);
    // 消费后清理
    this.registry.delete(contextId);
    return result;
  }

  /**
   * 格式化上下文详情（文件、决策、错误、依赖），不含主标题。
   * 用于在 tool.execute.before 中直接追加到子代理 prompt。
   */
  formatContextDetails(contextId: string): string {
    const context = this.registry.get(contextId);
    if (!context) return '';

    const parts: string[] = [];

    if (context.relevantFiles.length > 0) {
      parts.push('### 📁 相关文件');
      for (const file of context.relevantFiles) {
        parts.push(`- \`${file.path}\`` + (file.summary ? ` — ${file.summary}` : ''));
      }
    }

    if (context.decisions.length > 0) {
      parts.push('### 💡 前置决策');
      for (const d of context.decisions) {
        parts.push(`- ${d}`);
      }
    }

    if (context.errors.length > 0) {
      parts.push('### ⚠️ 近期错误');
      for (const e of context.errors) {
        parts.push(`- ${e}`);
      }
    }

    if (context.dependencies.length > 0) {
      parts.push('### 📦 依赖结果');
      for (const dep of context.dependencies) {
        parts.push(`- **${dep.agent}**: ${dep.keyOutput}`);
      }
    }

    return parts.length > 0 ? '\n' + parts.join('\n') + '\n' : '';
  }

  /**
   * Phase C: 捕获子代理结果。
   * 读取子 session 的最终输出 → 提取关键信息 → 存入 dependencyCache。
   */
  async captureResult(
    childSessionId: string,
    alias: string,
    agent: string,
  ): Promise<void> {
    if (!this.config.dependencyPropagation) return;

    try {
      const messagesResult = await this.client.session.messages({
        path: { id: childSessionId },
      });
      const messages = (messagesResult.data ?? []) as Array<{
        info?: { role?: string };
        parts?: Array<{ type?: string; text?: string }>;
      }>;

      // 从最后一条 assistant 消息提取关键输出
      let keyOutput = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info?.role === 'assistant') {
          for (const part of messages[i].parts ?? []) {
            if (part.type === 'text' && part.text) {
              keyOutput = part.text.slice(0, 500).replace(/\n/g, ' ');
              break;
            }
          }
          if (keyOutput) break;
        }
      }

      if (keyOutput) {
        this.dependencyCache.set(alias, {
          alias,
          agent,
          keyOutput,
          capturedAt: Date.now(),
        });
      }
    } catch {
      // SDK 调用失败时静默跳过
    }
  }

  /**
   * 生成上下文标记文本，追加到 task description 末尾。
   */
  formatMarker(contextId: string): string {
    return formatContextMarker(contextId);
  }

  /**
   * 暴露合并后的 strategy 供 index.ts 使用
   */
  getStrategy(agentType: string): ContextStrategy {
    return this.config.strategy[agentType] ?? 'none';
  }

  /**
   * 清理过期的依赖缓存（超过 10 分钟的条目）。
   */
  cleanupStaleDependencies(maxAgeMs: number = 10 * 60 * 1000): void {
    const now = Date.now();
    for (const [key, value] of this.dependencyCache) {
      if (now - value.capturedAt > maxAgeMs) {
        this.dependencyCache.delete(key);
      }
    }
  }
}
