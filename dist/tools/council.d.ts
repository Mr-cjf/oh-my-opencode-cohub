import { tool } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import type { createOpencodeClient } from '@opencode-ai/sdk';
export interface CouncillorConfig {
    /** "provider/model" */
    model: string;
    /** "max" | "high" | "medium" | "low" */
    variant?: string;
    /** Optional per-councillor prompt prefix */
    prompt?: string;
}
export interface CouncilPreset {
    [councillorName: string]: CouncillorConfig;
}
export interface CouncilConfig {
    /** Preset map (e.g. { default: { expert1: {...}, expert2: {...} } }) */
    presets: Record<string, CouncilPreset>;
    /** Per-councillor timeout in ms (default: 180000) */
    timeout?: number;
    /** Default preset name (default: "default") */
    default_preset?: string;
    /** Execution mode (default: "parallel") */
    councillor_execution_mode?: 'parallel' | 'serial';
    /** Retries on empty response (default: 3) */
    councillor_retries?: number;
}
/** Internal councillor result shape */
interface CouncillorResult {
    name: string;
    model: string;
    status: string;
    result?: string;
    error?: string;
}
export declare class CouncilManager {
    private client;
    private directory;
    private config;
    constructor(client: ReturnType<typeof createOpencodeClient>, directory: string, config: CouncilConfig);
    /**
     * Run a full council session.
     * Resolves a preset, runs all councillors, and returns formatted results.
     */
    runCouncil(prompt: string, presetName?: string, parentSessionId?: string): Promise<{
        success: boolean;
        result?: string;
        error?: string;
        councillorResults: CouncillorResult[];
    }>;
    private runCouncillors;
    private runCouncillorWithRetry;
    private runAgentSession;
}
/**
 * Create the `council_session` tool definition.
 *
 * The tool launches a multi-LLM council: multiple councillors run in parallel
 * against their assigned models, and their responses are assembled into a
 * structured block for the calling (co-council) agent to synthesize.
 *
 * Only the `co-council` agent is allowed to invoke this tool.
 */
export declare function createCouncilTool(ctx: PluginInput, councilManager: CouncilManager): Record<string, ReturnType<typeof tool>>;
export {};
//# sourceMappingURL=council.d.ts.map