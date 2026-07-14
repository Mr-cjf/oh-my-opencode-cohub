import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** 用户配置中单个代理的覆盖项 */
export interface AgentOverride {
  model?: string;
  variant?: string;
  prompt?: string;
}

export interface CoHubConfig {
  agents?: Record<string, AgentOverride>;
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

/** 示例配置模板 */
export const DEFAULT_CONFIG: CoHubConfig = {
  agents: {
    'co-orchestrator': { model: 'deepseek/deepseek-v4-pro', variant: 'max' },
    'co-oracle': { model: 'deepseek/deepseek-v4-pro', variant: 'max' },
    'co-librarian': { model: 'deepseek/deepseek-v4-flash', variant: 'low' },
    'co-explorer': { model: 'deepseek/deepseek-v4-flash', variant: 'low' },
    'co-designer': { model: 'minimax/MiniMax-M3', variant: 'medium' },
    'co-fixer': { model: 'deepseek/deepseek-v4-flash', variant: 'high' },
    'co-observer': { model: 'codermxtest/gpt-5.5', variant: 'low' },
    'co-council': { model: 'deepseek/deepseek-v4-pro', variant: 'high' },
    'co-rule-user': { model: 'deepseek/deepseek-v4-flash', variant: 'medium' },
    'co-rule-project': { model: 'deepseek/deepseek-v4-flash', variant: 'medium' },
    'co-rule-app': { model: 'deepseek/deepseek-v4-flash', variant: 'medium' },
    'co-planner': { model: 'deepseek/deepseek-v4-pro', variant: 'high' },
  },
};
