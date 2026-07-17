import type { ContextConfig } from '../context/types';
import { DEFAULT_CONTEXT_CONFIG } from '../context/types';
/** 单个 councillor 配置 */
export interface CouncillorConfig {
    model: string;
    variant?: string;
    prompt?: string;
}
export interface CouncilPreset {
    [councillorName: string]: CouncillorConfig;
}
export interface CouncilConfig {
    presets: Record<string, CouncilPreset>;
    timeout?: number;
    default_preset?: string;
    councillor_execution_mode?: 'parallel' | 'serial';
    councillor_retries?: number;
}
/** 用户配置中单个代理的覆盖项 */
export interface AgentOverride {
    model?: string;
    variant?: string;
    prompt?: string;
}
export interface CoHubConfig {
    agents?: Record<string, AgentOverride>;
    council?: CouncilConfig;
    context?: Partial<ContextConfig>;
}
/** 加载用户配置 */
export declare function loadCoHubConfig(): CoHubConfig;
/** 示例配置模板 */
export declare const DEFAULT_CONFIG: CoHubConfig;
export { DEFAULT_CONTEXT_CONFIG };
//# sourceMappingURL=loader.d.ts.map