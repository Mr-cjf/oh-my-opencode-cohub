import type { ContextStrategy, ContextConfig } from './types';
import type { createOpencodeClient } from '@opencode-ai/sdk';
type SdkClient = ReturnType<typeof createOpencodeClient>;
export declare class ContextEngine {
    /** contextId → TaskContext */
    private registry;
    /** alias → 前置子代理结果 */
    private dependencyCache;
    private client;
    private config;
    constructor(client: SdkClient, config?: Partial<ContextConfig>);
    /**
     * 同步注册上下文占位并返回 contextId。
     * 标记可立即注入到 output.args.description。
     */
    registerContext(args: {
        description: string;
    }): string;
    /**
     * 异步填充已注册的上下文（不阻塞工具启动）。
     */
    fillContextAsync(contextId: string, parentSessionId: string, args: {
        strategy: ContextStrategy;
    }): Promise<void>;
    /**
     * Phase B: 消费标记文本。
     * 从消息文本中提取 contextId → 查 registry → 替换标记为格式化上下文。
     * 返回替换后的完整文本，或 null（无标记或未找到上下文）。
     */
    consumeMarkedContext(messageText: string): string | null;
    /**
     * Phase C: 捕获子代理结果。
     * 读取子 session 的最终输出 → 提取关键信息 → 存入 dependencyCache。
     */
    captureResult(childSessionId: string, alias: string, agent: string): Promise<void>;
    /**
     * 生成上下文标记文本，追加到 task description 末尾。
     */
    formatMarker(contextId: string): string;
    /**
     * 暴露合并后的 strategy 供 index.ts 使用
     */
    getStrategy(agentType: string): ContextStrategy;
    /**
     * 清理过期的依赖缓存（超过 10 分钟的条目）。
     */
    cleanupStaleDependencies(maxAgeMs?: number): void;
}
export {};
//# sourceMappingURL=engine.d.ts.map