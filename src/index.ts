import type { Plugin } from '@opencode-ai/plugin';
import type { AgentConfig } from '@opencode-ai/sdk';
import { ORCHESTRATOR_PROMPT } from './prompts/orchestrator';
import { ORACLE_PROMPT } from './prompts/oracle';
import { LIBRARIAN_PROMPT } from './prompts/librarian';
import { EXPLORER_PROMPT } from './prompts/explorer';
import { DESIGNER_PROMPT } from './prompts/designer';
import { FIXER_PROMPT } from './prompts/fixer';
import { OBSERVER_PROMPT } from './prompts/observer';
import { COUNCIL_PROMPT } from './prompts/council';
import { RULE_USER_PROMPT } from './prompts/rule-user';
import { RULE_PROJECT_PROMPT } from './prompts/rule-project';
import { RULE_APP_PROMPT } from './prompts/rule-app';
import { PLANNER_PROMPT } from './prompts/planner';
import { CHINESE_LANGUAGE_INSTRUCTION } from './instructions/chinese';
import { TaskTracker } from './task-manager/tracker';
import { loadCoHubConfig, type AgentOverride } from './config/loader';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** 默认模型配置 */
const DEFAULT_MODELS: Record<string, string> = {
  orchestrator: 'deepseek/deepseek-v4-pro',
  oracle: 'deepseek/deepseek-v4-pro',
  librarian: 'deepseek/deepseek-v4-flash',
  explorer: 'deepseek/deepseek-v4-flash',
  designer: 'minimax/MiniMax-M3',
  fixer: 'deepseek/deepseek-v4-flash',
  observer: 'codermxtest/gpt-5.5',
  council: 'deepseek/deepseek-v4-pro',
  'rule-user': 'deepseek/deepseek-v4-flash',
  'rule-project': 'deepseek/deepseek-v4-flash',
  'rule-app': 'deepseek/deepseek-v4-flash',
  planner: 'deepseek/deepseek-v4-pro',
};

/** 中文提示词映射表 —— 供外部使用 */
export const CHINESE_PROMPTS: Record<string, string> = {
  'co-orchestrator': ORCHESTRATOR_PROMPT,
  'co-oracle': ORACLE_PROMPT,
  'co-librarian': LIBRARIAN_PROMPT,
  'co-explorer': EXPLORER_PROMPT,
  'co-designer': DESIGNER_PROMPT,
  'co-fixer': FIXER_PROMPT,
  'co-observer': OBSERVER_PROMPT,
  'co-council': COUNCIL_PROMPT,
  'co-rule-user': RULE_USER_PROMPT,
  'co-rule-project': RULE_PROJECT_PROMPT,
  'co-rule-app': RULE_APP_PROMPT,
  'co-planner': PLANNER_PROMPT,
};

/** 提示词覆盖映射 */
interface PromptOverrides {
  [agentName: string]: {
    replace?: string; // 完全替换
    append?: string;  // 追加
  };
}

/**
 * 从文件系统加载提示词覆盖
 * 优先级：项目级 > 用户级
 */
function loadFileOverrides(projectDir?: string): PromptOverrides {
  const overrides: PromptOverrides = {};
  const agentNames = [
    'co-orchestrator', 'co-oracle', 'co-librarian', 'co-explorer',
    'co-designer', 'co-fixer', 'co-observer', 'co-council',
    'co-rule-user', 'co-rule-project', 'co-rule-app', 'co-planner',
  ];

  const searchDirs: string[] = [];
  // 项目级优先
  if (projectDir) {
    searchDirs.push(path.join(projectDir, '.opencode', 'oh-my-opencode-cohub'));
  }
  // 用户级
  searchDirs.push(path.join(os.homedir(), '.config', 'opencode', 'oh-my-opencode-cohub'));

  for (const agent of agentNames) {
    for (const dir of searchDirs) {
      // 检查 {agent}.md（替换）
      const replacePath = path.join(dir, `${agent}.md`);
      if (!overrides[agent]?.replace && fs.existsSync(replacePath)) {
        try {
          overrides[agent] = { ...overrides[agent], replace: fs.readFileSync(replacePath, 'utf-8') };
        } catch { /* 忽略读取错误 */ }
      }
      // 检查 {agent}_append.md（追加）
      const appendPath = path.join(dir, `${agent}_append.md`);
      if (!overrides[agent]?.append && fs.existsSync(appendPath)) {
        try {
          overrides[agent] = { ...overrides[agent], append: fs.readFileSync(appendPath, 'utf-8') };
        } catch { /* 忽略读取错误 */ }
      }
    }
  }

  return overrides;
}

/**
 * 合并提示词：base + replace + append
 */
function resolvePrompt(base: string, replace?: string, append?: string): string {
  if (replace) {
    return replace + (append ? `\n\n${append}` : '');
  }
  if (append) {
    return `${base}\n\n${append}`;
  }
  return base;
}

/** Agent 定义：name + description + config */
interface AgentDefinition {
  name: string;
  description?: string;
  config: AgentConfig;
}

/**
 * 中文语言指令 —— 可注入到 AGENTS.md 或 instructions
 */
export const CHINESE_INSTRUCTION = CHINESE_LANGUAGE_INSTRUCTION;

const CoHubPlugin: Plugin = async (input, options) => {
  // 方式一：从文件系统加载覆盖
  const projectDir = input.directory || process.cwd();
  const fileOverrides = loadFileOverrides(projectDir);

  // 方式二：从 plugin config 读取覆盖
  const configOverrides: PromptOverrides = {};
  if (options?.overrides && typeof options.overrides === 'object') {
    Object.assign(configOverrides, options.overrides as PromptOverrides);
  }

  // 合并（文件优先，config 补充）
  const promptOverrides = { ...configOverrides, ...fileOverrides };

  const tracker = new TaskTracker();

  // ===== TUI 状态同步 =====
  const STATE_DIR = path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'oh-my-opencode-cohub');
  const STATE_FILE = path.join(STATE_DIR, 'tracker-state.json');

  // 定时写入 tracker 状态供 TUI 面板轮询
  function syncTrackerState(sessionId: string) {
    try {
      if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
      }
      const state = {
        updatedAt: Date.now(),
        runningAgents: tracker.getRunningAgents(sessionId),
        runningCount: tracker.getRunningCount(sessionId),
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf-8');
    } catch { /* 静默失败 */ }
  }

  // ===== Agent 配置写入（供 TUI 面板读取） =====
  const AGENT_CONFIG_FILE = path.join(STATE_DIR, 'cohub-state.json');
  function syncAgentConfig() {
    try {
      if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
      }
      const configs = agents.map(a => {
        const modelStr = a.config.model as string;
        const parts = modelStr.split('/');
        const provider = parts.length > 1 ? parts[0] : 'default';
        const shortModel = parts.length > 1 ? parts.slice(1).join('/') : modelStr;
        return {
          name: a.name,
          description: a.description,
          model: shortModel,
          variant: a.config.variant || null,
          provider,
        };
      });
      fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify({ updatedAt: Date.now(), agents: configs }), 'utf-8');
    } catch { /* 静默失败 */ }
  }

  // ===== Agent 定义（co-orchestrator 双注册：opencode.json<TAB> + return<ACP>） =====
  const agents = [
    {
      name: 'co-orchestrator',
      config: { mode: 'primary', model: 'deepseek/deepseek-v4-pro', variant: 'max', prompt: '你是 CoHub 纯调度者。用中文回复。' },
    },
    {
      name: 'co-oracle',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-pro', variant: 'max', temperature: 0.1, prompt: '你是战略顾问。用中文回复。' },
    },
    {
      name: 'co-librarian',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: '你是研究员。用中文回复。' },
    },
    {
      name: 'co-explorer',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: '你是代码探索者。用中文回复。' },
    },
    {
      name: 'co-designer',
      config: { mode: 'subagent', model: 'minimax/MiniMax-M3', variant: 'medium', prompt: '你是设计师。用中文回复。' },
    },
    {
      name: 'co-fixer',
      mode: 'subagent',
      description: '执行者——代码修改、构建、测试',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', variant: 'high', prompt: '你是执行者。用中文回复。' },
    },
    {
      name: 'co-observer',
      description: '观察者——图片/PDF/截图视觉分析',
      config: { mode: 'subagent', model: 'codermxtest/gpt-5.5', prompt: '你是观察者。用中文回复。' },
    },
    {
      name: 'co-council',
      description: '多模型共识——并行 LLM 综合',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-pro', variant: 'high', prompt: '你是多模型共识协调者。用中文回复。' },
    },
    {
      name: 'co-rule-user',
      description: '用户规范分析——~/.config/opencode/AGENTS.md',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: '你是用户规范分析代理。用中文回复。' },
    },
    {
      name: 'co-rule-project',
      description: '项目规范分析——项目 AGENTS.md',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: '你是项目规范分析代理。用中文回复。' },
    },
    {
      name: 'co-rule-app',
      description: '应用规则分析——.opencode/rules/*.md',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: '你是应用规则分析代理。用中文回复。' },
    },
    {
      name: 'co-planner',
      description: '方案制定——综合需求+信息+规范输出任务分解',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-pro', variant: 'high', prompt: '你是方案制定代理。用中文回复。' },
    },
  ];

  // ===== 加载用户配置覆盖 =====
  const userConfig = loadCoHubConfig();
  if (userConfig.agents) {
    for (const agent of agents) {
      const override = userConfig.agents[agent.name];
      if (override) {
        if (override.model) agent.config.model = override.model;
        if (override.variant) (agent.config as Record<string, unknown>).variant = override.variant;
        if (override.prompt) agent.config.prompt = override.prompt;
      }
    }
  }

  syncAgentConfig();  // 启动时立即写入 agent 配置供 TUI 面板读取

  return {
    name: 'oh-my-opencode-cohub',

    config: async (cfg: Record<string, unknown>) => {
      const c = cfg as { agent?: Record<string, unknown> };
      c.agent ??= {};
      for (const agent of agents) {
        c.agent[agent.name] = {
          ...agent.config,
          name: agent.name,
          description: agent.description,
        };
      }
      try { fs.writeFileSync(path.join(STATE_DIR, 'config-hook-ran.json'), JSON.stringify({ ran: true, count: agents.length })); } catch {}
    },

    'tool.execute.before': async (input, output) => {
      try {
        if (input.tool === 'task') {
          const args = output.args ?? {};
          tracker.registerBeforeTask(input.sessionID, {
            description: typeof args.description === 'string' ? args.description : undefined,
            subagent_type: typeof args.subagent_type === 'string' ? args.subagent_type : undefined,
            task_id: typeof args.task_id === 'string' ? args.task_id : undefined,
            background: typeof args.background === 'boolean' ? args.background : undefined,
          });
          syncTrackerState(input.sessionID ?? '');
        }
      } catch { /* 静默失败，不影响正常功能 */ }
    },

    // 🆕 拦截 task 工具执行后 — 更新任务状态
    'tool.execute.after': async (input, _output) => {
      try {
        if (input.tool === 'task') {
          tracker.updateAfterTask(input.sessionID, 'completed');
          syncTrackerState(input.sessionID ?? '');
        }
      } catch { /* 静默失败 */ }
    },

    // 🆕 注入 Background Job Board 到最后一条 user 消息中
    'experimental.chat.messages.transform': async (_input, output) => {
      try {
        const board = tracker.getBoardText();
        if (board && output.messages && Array.isArray(output.messages)) {
          // 在最后一条 user 消息的 text part 末尾追加 board 内容
          for (let i = output.messages.length - 1; i >= 0; i--) {
            const msg = output.messages[i];
            if (msg.info.role === 'user') {
              for (let j = msg.parts.length - 1; j >= 0; j--) {
                const part = msg.parts[j];
                if (part.type === 'text') {
                  part.text += '\n\n' + board;
                  break;
                }
              }
              break;
            }
          }
        }
      } catch { /* 静默失败 */ }
    },

    'experimental.chat.system.transform': async (_input, output) => {
      // 将中文语言指令注入到系统提示词中
      output.system.push(CHINESE_LANGUAGE_INSTRUCTION);
    },
  };
};

export default CoHubPlugin;
