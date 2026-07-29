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
const USER_CONFIG_PATH = path.join(os.homedir(), '.config', 'opencode', 'oh-my-opencode-cohub.json');

/** 加载用户配置（项目级优先覆盖用户级） */
export function loadCoHubConfig(projectDir?: string): CoHubConfig {
  const base = readJSON(USER_CONFIG_PATH) as CoHubConfig;
  if (!projectDir) return base;

  const projectPath = path.join(projectDir, '.opencode', 'oh-my-opencode-cohub.json');
  const project = readJSON(projectPath) as CoHubConfig;
  if (!project || Object.keys(project).length === 0) return base;

  // 项目级覆盖用户级（shallow merge per-agent）
  const merged: CoHubConfig = { ...base };
  if (project.agents) {
    merged.agents = { ...base.agents, ...project.agents };
  }
  if (project.council) {
    merged.council = project.council;
  }
  if (project.context) {
    merged.context = { ...base.context, ...project.context };
  }
  return merged;
}

function readJSON(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export { DEFAULT_CONTEXT_CONFIG };
