import type { RelevantFile } from './types';
/** SDK v2 消息格式（简化） */
interface SdkMessage {
    info?: {
        role?: string;
    };
    parts?: Array<{
        type?: string;
        text?: string;
        tool?: string;
        args?: unknown;
        tool_result?: unknown;
    }>;
}
/**
 * 从消息列表中提取相关文件。
 * 扫描 Read/Edit/Write/Glob/Grep 工具调用和 tool_result 中的路径。
 */
export declare function extractRelevantFiles(messages: SdkMessage[], maxFiles: number, windowSize: number): RelevantFile[];
/**
 * 从 assistant 消息中提取关键决策。
 * 匹配包含决策关键词的句子。
 */
export declare function extractDecisions(messages: SdkMessage[], maxDecisions: number, windowSize: number): string[];
/**
 * 从 bash 输出中提取编译/测试错误。
 */
export declare function extractErrors(messages: SdkMessage[], maxErrors: number, windowSize: number): string[];
export {};
//# sourceMappingURL=extractor.d.ts.map