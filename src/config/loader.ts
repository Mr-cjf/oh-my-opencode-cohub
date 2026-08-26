import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ContextConfig } from '../context/types';
import type { QualityConfig } from '../task-manager/quality';
import { DEFAULT_CONTEXT_CONFIG } from '../context/types';

// P2-4: Council 相关类型统一复用 council.ts 定义，消除双定义漂移
//（纯类型 import + re-export，运行时零依赖；council.ts 不 import loader.ts，无循环依赖）
import type { CouncilConfig, CouncilPreset, CouncillorConfig } from '../tools/council';
export type { CouncilConfig, CouncilPreset, CouncillorConfig };

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
  /** 质量回送配置（P0-1 负反馈闭环，默认开启） */
  quality?: Partial<QualityConfig>;
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
  if (project.quality) {
    merged.quality = { ...base.quality, ...project.quality };
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
