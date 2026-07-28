import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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
  context?: Partial<ContextConfig>;  // 用户可覆盖部分字段
}

/** 配置文件路径 */
const CONFIG_PATH = path.join(os.homedir(), '.config', 'opencode', 'oh-my-opencode-cohub.json');

/** 加载用户配置 */
export function loadCoHubConfig(): CoHubConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as CoHubConfig;
  } catch {
    return {};
  }
}

export { DEFAULT_CONTEXT_CONFIG };
