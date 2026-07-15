// src/context/engine.ts — 上下文引擎核心

import type { ContextStrategy, TaskContext, ContextConfig, DependencyResult } from './types';
import { DEFAULT_CONTEXT_CONFIG } from './types';
import { extractRelevantFiles, extractDecisions, extractErrors } from './extractor';
import { formatContextMarker, replaceMarkerWithContext } from './formatter';
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
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
  }

  /**
   * Phase A: 构建上下文。
   * 从父 session 提取信息 → 构造 TaskContext → 存入 registry → 返回 contextId。
   */
  async constructContext(
    parentSessionId: string,
    args: {
      description: string;
      subagent_type: string;
      strategy: ContextStrategy;
    },
  ): Promise<string> {
    const contextId = crypto.randomUUID();
    const context: TaskContext = {
      goal: args.description,
      relevantFiles: [],
      decisions: [],
      errors: [],
      dependencies: [],
    };

    if (args.strategy === 'none') {
      this.registry.set(contextId, context);
      return contextId;
    }

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

      // 注入前置依赖结果
      if (this.config.dependencyPropagation && this.dependencyCache.size > 0) {
        context.dependencies = Array.from(this.dependencyCache.values())
          .slice(-this.config.maxDependencies);
      }
    } catch {
      // SDK 调用失败时返回最小上下文
    }

    this.registry.set(contextId, context);
    return contextId;
  }

  /**
   * Phase B: 消费标记文本。
   * 从消息文本中提取 contextId → 查 registry → 替换标记为格式化上下文。
   * 返回替换后的完整文本，或 null（无标记或未找到上下文）。
   */
  consumeMarkedContext(messageText: string): string | null {
    const markerMatch = messageText.match(/<!-- CONTEXT:ID=([a-f0-9-]+) -->/);
    if (!markerMatch) return null;

    const contextId = markerMatch[1];
    const context = this.registry.get(contextId);
    if (!context) {
      // 上下文已过期或被清理，移除标记
      return messageText.replace(/<!-- CONTEXT:ID=[a-f0-9-]+ -->/, '');
    }

    const result = replaceMarkerWithContext(messageText, context);
    // 消费后清理
    this.registry.delete(contextId);
    return result;
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
