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
import { ContextEngine } from './context/engine';
import { resolveStrategy } from './context/strategy';
import type { ContextStrategy } from './context/types';
import { loadCoHubConfig, type AgentOverride } from './config/loader';
import { createCouncilTool, CouncilManager } from './tools/council';
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
      config: { mode: 'primary', model: 'deepseek/deepseek-v4-pro', variant: 'max', prompt: ORCHESTRATOR_PROMPT + '\n\n' + CHINESE_LANGUAGE_INSTRUCTION },
    },
    {
      name: 'co-oracle',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-pro', variant: 'max', temperature: 0.1, prompt: ORACLE_PROMPT },
    },
    {
      name: 'co-librarian',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: LIBRARIAN_PROMPT },
    },
    {
      name: 'co-explorer',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: EXPLORER_PROMPT },
    },
    {
      name: 'co-designer',
      config: { mode: 'subagent', model: 'minimax/MiniMax-M3', variant: 'medium', prompt: DESIGNER_PROMPT },
    },
    {
      name: 'co-fixer',
      mode: 'subagent',
      description: '执行者——代码修改、构建、测试',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', variant: 'high', prompt: FIXER_PROMPT },
    },
    {
      name: 'co-observer',
      description: '观察者——图片/PDF/截图视觉分析',
      config: { mode: 'subagent', model: 'codermxtest/gpt-5.5', prompt: OBSERVER_PROMPT },
    },
    {
      name: 'co-council',
      description: '多模型共识——并行 LLM 综合',
      config: {
        mode: 'subagent',
        model: 'deepseek/deepseek-v4-pro',
        variant: 'high',
        prompt: COUNCIL_PROMPT,
        permission: { council_session: 'allow' as const },
      },
    },
    {
      name: 'co-rule-user',
      description: '用户规范分析——~/.config/opencode/AGENTS.md',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: RULE_USER_PROMPT },
    },
    {
      name: 'co-rule-project',
      description: '项目规范分析——项目 AGENTS.md',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: RULE_PROJECT_PROMPT },
    },
    {
      name: 'co-rule-app',
      description: '应用规则分析——.opencode/rules/*.md',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-flash', prompt: RULE_APP_PROMPT },
    },
    {
      name: 'co-planner',
      description: '方案制定——综合需求+信息+规范输出任务分解',
      config: { mode: 'subagent', model: 'deepseek/deepseek-v4-pro', variant: 'high', prompt: PLANNER_PROMPT },
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

  // ===== 应用文件级覆盖（优先级：文件替换 > 文件追加 > JSON 配置 > 内置常量） =====
  for (const agent of agents) {
    const override = fileOverrides[agent.name];
    if (override) {
      agent.config.prompt = resolvePrompt(
        agent.config.prompt as string,
        override.replace,
        override.append,
      );
    }
  }

  // ===== Council 初始化（无配置时使用内置默认预设） =====
  const DEFAULT_COUNCIL_CONFIG = {
    default_preset: 'default',
    timeout: 180000,
    councillor_execution_mode: 'parallel' as const,
    councillor_retries: 3,
    presets: {
      default: {
        alpha: { model: 'deepseek/deepseek-v4-pro', variant: 'max' },
        beta: { model: 'deepseek/deepseek-v4-flash', variant: 'high' },
        gamma: { model: 'minimax/MiniMax-M3', variant: 'medium' },
      },
    },
  };
  // 初始化上下文引擎
  const contextConfig = userConfig.context ?? {};
  const contextEngine = new ContextEngine(input.client, contextConfig);

  const councilConfig = userConfig.council ?? DEFAULT_COUNCIL_CONFIG;
  const councilManager = new CouncilManager(input.client, input.directory, councilConfig);
  const councilTools = createCouncilTool(input, councilManager);

  syncAgentConfig();  // 启动时立即写入 agent 配置供 TUI 面板读取

  // ===== 辅助：从 tool output 中提取子任务 session ID =====
  function extractChildSessionId(output: unknown): string | undefined {
    if (!output || typeof output !== 'object') return undefined;
    const o = output as Record<string, unknown>;
    // metadata 中可能包含 sessionId / taskId
    const meta = o.metadata as Record<string, unknown> | undefined;
    if (meta) {
      if (typeof meta.sessionId === 'string') return meta.sessionId;
      if (typeof meta.taskId === 'string') return meta.taskId;
      if (typeof meta.task_id === 'string') return meta.task_id;
      if (typeof meta.id === 'string') return meta.id;
    }
    // 输出文本中可能包含 session ID（如 "Session: abc123"）
    const text = typeof o.output === 'string' ? o.output : '';
    const m = text.match(/\b(session|task)[_\s]?(?:id|ID)[:\s]+(\S+)/i);
    if (m) return m[2];
    return undefined;
  }

  // ===== 辅助：从 event 中安全提取 sessionId =====
  function extractSessionIdFromEvent(props: unknown): string | undefined {
    if (!props || typeof props !== 'object') return undefined;
    const p = props as Record<string, unknown>;
    // 尝试多个可能的路径
    const info = p.info as Record<string, unknown> | undefined;
    if (info?.id) return info.id as string;
    if (typeof p.sessionID === 'string') return p.sessionID;
    if (typeof p.sessionId === 'string') return p.sessionId;
    return undefined;
  }

  // ===== 兜底：定时清理过期背景任务（30 分钟超时） =====
  const STALE_TIMEOUT_MS = 30 * 60 * 1000;
  const cleanupTimer = setInterval(() => {
    try {
      tracker.cleanupStaleJobs(STALE_TIMEOUT_MS);
    } catch { /* 静默 */ }
  }, 30_000);

  const contextCleanupTimer = setInterval(() => {
    try { contextEngine.cleanupStaleDependencies(); } catch {}
  }, 60_000);

  // ===== 构建 agent 对象（供直接返回 + config hook 双重注册） =====
  const agentConfigs: Record<string, unknown> = {};
  for (const agent of agents) {
    agentConfigs[agent.name] = {
      ...agent.config,
      name: agent.name,
      description: agent.description,
    };
  }

  return {
    name: 'oh-my-opencode-cohub',

    // 方式一：直接返回 agent 字段（HTTP 服务器模式更可靠）
    agent: agentConfigs,

    // council_session 工具（多模型并行共识）
    tool: councilTools,

    // 方式二：config hook 再次写入（确保兼容所有模式）
    config: async (cfg: Record<string, unknown>) => {
      const c = cfg as { agent?: Record<string, unknown> };
      c.agent ??= {};
      for (const [name, config] of Object.entries(agentConfigs)) {
        c.agent[name] = config;
      }
      try { fs.writeFileSync(path.join(STATE_DIR, 'config-hook-ran.json'), JSON.stringify({ ran: true, count: agents.length })); } catch {}
    },

    'tool.execute.before': async (input, output) => {
      try {
        if (input.tool === 'task') {
          const args = output.args ?? {};
          const subagentType = typeof args.subagent_type === 'string' ? args.subagent_type : undefined;
          const description = typeof args.description === 'string' ? args.description : '';

          // 现有：注册任务
          tracker.registerBeforeTask(input.sessionID, {
            description,
            subagent_type: subagentType,
            task_id: typeof args.task_id === 'string' ? args.task_id : undefined,
            background: typeof args.background === 'boolean' ? args.background : undefined,
          });
          syncTrackerState(input.sessionID ?? '');

          // 新增：构建上下文
          if (subagentType) {
            // 修复 C3: 使用 engine 的合并策略
            const strategy = resolveStrategy(
              subagentType,
              contextEngine.getStrategy(subagentType) !== undefined
                ? { [subagentType]: contextEngine.getStrategy(subagentType) }
                : contextConfig.strategy ?? {},
              typeof args.context_override === 'string'
                ? (args.context_override as ContextStrategy)
                : undefined,
            );
            if (strategy !== 'none') {
              console.error('[CONTEXT-DEBUG] before hook: strategy=', strategy, 'agent=', subagentType);
              console.error('[CONTEXT-DEBUG] before hook: output.args type=', typeof output.args, 'isNull=', output.args === null);
              // 修复 C1+C2: 同步注册 + 立即注入标记
              const contextId = contextEngine.registerContext({
                description,
              });
              output.args ??= {};  // ★ 防御 undefined args
              output.args.description = description +
                contextEngine.formatMarker(contextId);
              console.error('[CONTEXT-DEBUG] before hook: marker appended, contextId=', contextId);
              console.error('[CONTEXT-DEBUG] before hook: description preview=', (output.args.description as string).slice(-80));
              // 异步填充（不阻塞工具启动）
              contextEngine.fillContextAsync(contextId, input.sessionID, {
                strategy,
              }).catch(() => {});  // 修复 I1: 显式 catch
            }
          }
        }
      } catch { /* 静默失败 */ }
    },

    // 🆕 拦截 task 工具执行后 — 更新任务状态
    'tool.execute.after': async (input, output) => {
      try {
        // cancel_task 集成：标记任务已取消
        if (input.tool === 'cancel_task') {
          const args = input.args as Record<string, unknown> | undefined;
          const taskId = args?.task_id;
          if (typeof taskId === 'string') tracker.markCancelled(taskId);
          syncTrackerState(input.sessionID ?? '');
        }
        if (input.tool === 'task') {
          // 尝试从 output 中提取子任务 session ID
          const childSessionId = extractChildSessionId(output);
          tracker.updateAfterTask(input.sessionID, 'completed', childSessionId);
          syncTrackerState(input.sessionID ?? '');
        }
      } catch { /* 静默失败 */ }
    },

    // 🆕 监听 session 事件 — 背景任务完成时更新状态
    event: async (input) => {
      try {
        const e = input.event as { type: string; properties?: unknown };
        const sessionId = extractSessionIdFromEvent(e.properties);
        if (!sessionId) return;

        if (e.type === 'session.idle') {
          tracker.updateByChildSessionId(sessionId, 'completed');
          syncTrackerState(tracker.currentParentSessionId);

          // 新增：捕获子代理结果用于依赖传播
          const job = tracker.getJobBySessionId(sessionId);
          if (job) {
            void contextEngine.captureResult(sessionId, job.alias, job.agent);
          }
        } else if (e.type === 'session.deleted' || e.type === 'session.error') {
          tracker.updateByChildSessionId(sessionId, 'errored');
          syncTrackerState(tracker.currentParentSessionId);
        }
      } catch { /* 静默失败 */ }
    },

    // 🆕 扫描上下文标记 + 注入 Background Job Board
    'experimental.chat.messages.transform': async (_input, output) => {
      try {
        // 新增：扫描并替换上下文标记（在所有 user 消息中）
        if (output.messages && Array.isArray(output.messages)) {
          const userMsgs = output.messages.filter((m: any) => m.info?.role === 'user');
          console.error('[CONTEXT-DEBUG] transform: total messages=', output.messages.length, 'user messages=', userMsgs.length);
          for (const msg of output.messages) {
            if (msg.info.role !== 'user') continue;
            for (const part of msg.parts ?? []) {
              if (part.type !== 'text' || !part.text) continue;
              const hasMarker = /CONTEXT:ID=/.test(part.text);
              if (hasMarker) {
                console.error('[CONTEXT-DEBUG] transform: FOUND marker in user msg, text preview=', part.text.slice(0, 200));
              }
              const replaced = contextEngine.consumeMarkedContext(part.text);
              if (replaced !== null) {
                console.error('[CONTEXT-DEBUG] transform: marker REPLACED, new text preview=', part.text.slice(0, 200));
              }
            }
          }
        }

        // 现有：注入 Background Job Board（到最后一条 user 消息）
        const board = tracker.getBoardText();
        if (board && output.messages && Array.isArray(output.messages)) {
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

    dispose: async () => {
      clearInterval(cleanupTimer);
      clearInterval(contextCleanupTimer);
    },
  };
};

export const server = CoHubPlugin;
export default CoHubPlugin;
