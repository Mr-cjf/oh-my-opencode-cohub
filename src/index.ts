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
import { appendLog } from './utils/log.js';

/** 中文提示词映射表 */
const CHINESE_PROMPTS: Record<string, string> = {
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
        } catch (err) {
          appendLog('loadFileOverrides', '读取replace文件失败', err);
        }
      }
      // 检查 {agent}_append.md（追加）
      const appendPath = path.join(dir, `${agent}_append.md`);
      if (!overrides[agent]?.append && fs.existsSync(appendPath)) {
        try {
          overrides[agent] = { ...overrides[agent], append: fs.readFileSync(appendPath, 'utf-8') };
        } catch (err) {
          appendLog('loadFileOverrides', '读取append文件失败', err);
        }
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
const CHINESE_INSTRUCTION = CHINESE_LANGUAGE_INSTRUCTION;

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
      const configs = agents.filter(a => (a.config as Record<string, unknown>).model).map(a => {
        const modelStr = (a.config as Record<string, unknown>).model as string;
        const parts = modelStr.split('/');
        const provider = parts.length > 1 ? parts[0] : 'default';
        const shortModel = parts.length > 1 ? parts.slice(1).join('/') : modelStr;
        return {
          name: a.name,
          description: a.description,
          model: shortModel,
          variant: (a.config as Record<string, unknown>).variant || null,
          provider,
        };
      });
      fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify({ updatedAt: Date.now(), agents: configs }), 'utf-8');
      void appendLog('syncAgentConfig', `已同步 ${configs.length} 个 agent: ${JSON.stringify(
        configs.map(c => ({ name: c.name, model: c.model, variant: c.variant })),
      )}`);
    } catch { /* 静默失败 */ }
  }

  // ===== Agent 定义（co-orchestrator 双注册：opencode.json<TAB> + return<ACP>） =====
  const agents = [
    {
      name: 'co-orchestrator',
      config: { mode: 'primary', prompt: ORCHESTRATOR_PROMPT },
    },
    {
      name: 'co-oracle',
      config: { mode: 'subagent', temperature: 0.1, prompt: ORACLE_PROMPT },
    },
    {
      name: 'co-librarian',
      config: { mode: 'subagent', prompt: LIBRARIAN_PROMPT },
    },
    {
      name: 'co-explorer',
      config: { mode: 'subagent', prompt: EXPLORER_PROMPT },
    },
    {
      name: 'co-designer',
      config: { mode: 'subagent', prompt: DESIGNER_PROMPT },
    },
    {
      name: 'co-fixer',
      mode: 'subagent',
      description: '执行者——代码修改、构建、测试',
      config: { mode: 'subagent', prompt: FIXER_PROMPT },
    },
    {
      name: 'co-observer',
      description: '观察者——图片/PDF/截图视觉分析',
      config: { mode: 'subagent', prompt: OBSERVER_PROMPT },
    },
    {
      name: 'co-council',
      description: '多模型共识——并行 LLM 综合',
      config: {
        mode: 'subagent',
        prompt: COUNCIL_PROMPT,
        permission: { council_session: 'allow' as const },
      },
    },
    {
      name: 'co-rule-user',
      description: '用户规范分析——~/.config/opencode/AGENTS.md',
      config: { mode: 'subagent', prompt: RULE_USER_PROMPT },
    },
    {
      name: 'co-rule-project',
      description: '项目规范分析——项目 AGENTS.md',
      config: { mode: 'subagent', prompt: RULE_PROJECT_PROMPT },
    },
    {
      name: 'co-rule-app',
      description: '应用规则分析——.opencode/rules/*.md',
      config: { mode: 'subagent', prompt: RULE_APP_PROMPT },
    },
    {
      name: 'co-planner',
      description: '方案制定——综合需求+信息+规范输出任务分解',
      config: { mode: 'subagent', prompt: PLANNER_PROMPT },
    },
  ];

  // ===== 加载用户配置覆盖 =====
  const userConfig = loadCoHubConfig(projectDir);
  if (userConfig.agents) {
    for (const agent of agents) {
      const override = userConfig.agents[agent.name];
      if (override) {
        if (override.model) (agent.config as Record<string, unknown>).model = override.model;
        if (override.variant) (agent.config as Record<string, unknown>).variant = override.variant;
        if (override.prompt) agent.config.prompt = override.prompt;
      }
    }
  }

  syncAgentConfig();  // 写入 agent 配置供 TUI 面板读取（覆盖完成后执行）

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

  // ===== 核心规则提取（从内置常量提取，不受 .md / hub config 覆盖影响） =====
  const coreRulesInjectionText = ORCHESTRATOR_PROMPT
    ? `\n${ORCHESTRATOR_PROMPT}`
    : null;
  void appendLog('critical_rules', coreRulesInjectionText
    ? `已注入完整提示词: 长度=${ORCHESTRATOR_PROMPT.length}`
    : '⚠️ ORCHESTRATOR_PROMPT 为空，注入跳过');

  // ===== Council 初始化（无配置时使用内置默认预设） =====
  const DEFAULT_COUNCIL_CONFIG = {
    default_preset: 'default',
    timeout: 180000,
    councillor_execution_mode: 'parallel' as const,
    councillor_retries: 3,
    presets: {
      default: {},  // 空预设，完全依赖 oh-my-opencode-cohub.json 配置
    },
  };
  // 初始化上下文引擎
  const contextConfig = userConfig.context ?? {};
  const contextEngine = new ContextEngine(input.client, contextConfig);

  const councilConfig = userConfig.council ?? DEFAULT_COUNCIL_CONFIG;
  const councilManager = new CouncilManager(input.client, input.directory, councilConfig);
  const councilTools = createCouncilTool(input, councilManager);

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
    } catch (err) {
      appendLog('cleanupStaleJobs', '定时清理过期任务失败', err);
    }
  }, 30_000);

  const contextCleanupTimer = setInterval(() => {
    try { contextEngine.cleanupStaleDependencies(); } catch (err) {
      appendLog('contextCleanupTimer', '定时清理上下文失败', err);
    }
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

    // 工具：council_session（多模型并行共识）
    tool: councilTools,

    // 方式二：config hook 再次写入（确保兼容所有模式）
    config: async (cfg: Record<string, unknown>) => {
      const c = cfg as { agent?: Record<string, unknown>; default_agent?: string };
      c.agent ??= {};

      // 兜底设置默认代理（与 opencode.json 的 default_agent 互补）
      if (!c.default_agent) {
        c.default_agent = 'co-orchestrator';
      }

      // 合并策略：
      // - opencode.json 优先（用户手动字段：mode/tools/temperature 等）
      // - hub config 的 model/variant 优先（oh-my-opencode-cohub.json 是配置源）
      // install 会将 hub config 同步写入 opencode.json，但用户可能只更新 hub config 未重装
      for (const [name, pluginConfig] of Object.entries(agentConfigs)) {
        const existing = c.agent[name] as Record<string, unknown> | undefined;
        const pc = pluginConfig as Record<string, unknown>;
        const merged: Record<string, unknown> = existing
          ? { ...pc, ...existing }
          : { ...pc };
        // hub config 的 model/variant 总是覆盖 opencode.json 中的值
        if (pc.model) merged.model = pc.model;
        if (pc.variant) merged.variant = pc.variant;
        c.agent[name] = merged;
      }

      try { fs.writeFileSync(path.join(STATE_DIR, 'config-hook-ran.json'), JSON.stringify({ ran: true, count: agents.length })); } catch (err) {
        void appendLog('config', '双重注册写入文件失败', err);
      }
      void appendLog('config.hook', `config hook 注入完成: ${JSON.stringify(
        Object.entries(agentConfigs).map(([name, cfg]) => {
          const c = cfg as Record<string, unknown>;
          const prompt = typeof c.prompt === 'string' ? c.prompt : '';
          return {
            name,
            promptLen: prompt.length,
            promptPreview: prompt.slice(0, 120),
            hasModel: !!c.model,
            hasVariant: !!c.variant,
          };
        }),
      )}`);
    },

    'tool.execute.before': async (input, output) => {
      try {
        if (input.tool === 'task') {
          const args = output.args ?? {};
          const subagentType = typeof args.subagent_type === 'string' ? args.subagent_type : '';
          const description = typeof args.description === 'string' ? args.description : '';

          // 现有：注册任务
          // 防御：拦截非法 task_id（非 ses_ 前缀），同时从 output.args 删除避免 OpenCode 校验失败
          if (typeof args.task_id === 'string' && args.task_id !== '' && !args.task_id.startsWith('ses_')) {
            delete output.args.task_id;
          }
          tracker.registerBeforeTask(input.sessionID, {
            description,
            subagent_type: subagentType,
            task_id: (typeof output.args.task_id === 'string' && output.args.task_id.startsWith('ses_')) ? output.args.task_id : undefined,
            background: typeof args.background === 'boolean' ? args.background : undefined,
          });
          syncTrackerState(input.sessionID ?? '');

          // 新增：构建上下文
          if (subagentType) {
            const strategy = typeof args.context_override === 'string'
              ? (args.context_override as ContextStrategy)
              : contextEngine.getStrategy(subagentType);
            if (strategy !== 'none') {
              const contextId = contextEngine.registerContext({ description });
              output.args ??= {};
              const contextBlock = '\n\n### 📋 任务上下文 (CoHub 自动注入)\n' +
                '**当前任务**: ' + description + '\n';
              // prompt 是子代理实际看到的消息，description 只是 session 标题
              const targetField = typeof output.args.prompt === 'string' ? 'prompt' : 'description';
              output.args[targetField] = ((targetField === 'prompt' ? output.args.prompt : description) ?? '') + contextBlock;


              // 填充上下文（同步等待完成，确保子代理启动前上下文已就绪）
              await contextEngine.fillContextAsync(contextId, input.sessionID, {
                strategy,
              });

              // 追加详细上下文（文件、决策、错误等）
              const details = contextEngine.formatContextDetails(contextId);
              if (details) {
                output.args[targetField] += details;
              }

              // 诊断日志：记录完整上下文注入结果（超过 50KB 自动截断保留最后 30 条）
              const logPath = path.join(os.tmpdir(), 'opencode', 'ctx-diag.log');
              try {
                const stat = fs.statSync(logPath);
                if (stat.size > 50 * 1024) {
                  // 超过 50KB，保留最后 30 条
                  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
                  fs.writeFileSync(logPath, lines.slice(-30).join('\n') + '\n');
                }
              } catch { /* 文件不存在，跳过 */ }
              const finalPrompt = typeof output.args?.prompt === 'string' ? output.args.prompt : '';
              fs.appendFileSync(logPath, JSON.stringify({
                time: new Date().toISOString(),
                session: input.sessionID?.slice(0, 20) ?? '?',
                subagent: subagentType,
                strategy,
                targetField,
                hasDetails: !!details,
                detailsLen: details ? details.length : 0,
                detailsPreview: details ? details.replace(/\n/g, '\\n').slice(0, 200) : '',
                promptEnd: finalPrompt.slice(-120),
              }) + '\n');

            }
          }
        }
      } catch (err) {
        appendLog('tool.execute.before', 'hook 失败', err);
      }
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
      } catch (err) {
        appendLog('tool.execute.after', 'hook 失败', err);
      }
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
        } else if (e.type === 'session.deleted') {
          tracker.updateByChildSessionId(sessionId, 'errored');
          syncTrackerState(tracker.currentParentSessionId);
        } else if (e.type === 'session.error') {
          tracker.updateByChildSessionId(sessionId, 'errored');
          syncTrackerState(tracker.currentParentSessionId);
        }
      } catch (err) {
        appendLog('event', '事件处理失败', err);
      }
    },

    // 🆕 注入 Background Job Board
    'experimental.chat.messages.transform': async (_input, output) => {
      try {
        if (!output.messages || !Array.isArray(output.messages)) return;

        // 诊断日志：记录消息 parts 分布，发现空 parts 时告警
        if (output.messages) {
          for (let d = 0; d < output.messages.length; d++) {
            const msg = output.messages[d];
            const parts = msg.parts;
            if (!parts || !Array.isArray(parts) || parts.length === 0) {
              void appendLog('messages.transform',
                `⚠️ 消息[${d}] role=${msg.info?.role ?? '?'} parts为空`);
            } else {
              const hasTextPart = parts.some(p => p.type === 'text');
              if (!hasTextPart && msg.info?.role === 'user') {
                void appendLog('messages.transform',
                  `⚠️ 消息[${d}] role=user parts无text类型, types=[${parts.map(p => p.type).join(',')}]`);
              }
            }
          }
        }

        // 从最后一条 user 消息提取 sessionID
        let lastUserMsg: (typeof output.messages)[number] | undefined;
        let sessionID: string | undefined;
        for (let i = output.messages.length - 1; i >= 0; i--) {
          const m = output.messages[i];
          if (m.info?.role === 'user') {
            lastUserMsg = m;
            sessionID = m.info?.sessionID as string | undefined;
            break;
          }
        }

        if (!lastUserMsg) return;

        // 防御：parts 不存在、非数组、或为空数组时，推入占位 text part
        if (!lastUserMsg.parts || !Array.isArray(lastUserMsg.parts) || lastUserMsg.parts.length === 0) {
          lastUserMsg.parts = [{ type: 'text', text: ' ' }] as any;
          void appendLog('messages.transform',
            `⚠️ lastUserMsg parts为空，已推入占位text part (session=${sessionID?.slice(0,20) ?? '?'})`);
        } else if (!lastUserMsg.parts.some(p => p.type === 'text')) {
          // parts 存在但没有任何 text 类型，推入一个空 text part
          lastUserMsg.parts.push({ type: 'text', text: ' ' } as any);
          void appendLog('messages.transform',
            `⚠️ lastUserMsg parts无text类型，已推入占位text part (session=${sessionID?.slice(0,20) ?? '?'})`);
        }

        // 1. 注入 Background Job Board
        const board = tracker.getBoardText();
        if (board) {
          for (let j = lastUserMsg.parts.length - 1; j >= 0; j--) {
            const part = lastUserMsg.parts[j];
            if (part.type === 'text') {
              part.text = (part.text || '') + '\n\n' + board;
              break;
            }
          }
        }
        // 3. 注入核心规则（从内置常量提取，不受覆盖影响）
        if (coreRulesInjectionText) {
          for (let k = lastUserMsg.parts.length - 1; k >= 0; k--) {
            const part = lastUserMsg.parts[k];
            if (part.type === 'text') {
              part.text = (part.text || '') + coreRulesInjectionText;
              break;
            }
          }
          void appendLog('messages.transform', `已注入 orchestrator 完整提示词: 长度=${coreRulesInjectionText.length}, 内容预览=${coreRulesInjectionText.slice(0, 200)}`);
        } else {
          void appendLog('messages.transform', '⚠️ orchestrator 提示词为空，注入跳过');
        }

        // 兜底：注入完成后若 lastUserMsg content 仍为空，设非空占位
        {
          let userContent = '';
          for (const p of lastUserMsg.parts ?? []) {
            if (p.type === 'text') userContent += (p.text ?? '');
          }
          if (!userContent.trim()) {
            for (const p of lastUserMsg.parts ?? []) {
              if (p.type === 'text') { p.text = ' '; break; }
            }
            void appendLog('messages.transform',
              `⚠️ 注入后 content 为空，已设空格占位 (session=${sessionID?.slice(0,20) ?? '?'})`);
          }
        }

      } catch (err) {
        appendLog('messages.transform', 'hook 失败', err);
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      // 将中文语言指令注入到系统提示词中
      try {
        if (output?.system && Array.isArray(output.system)) {
          output.system.push(CHINESE_LANGUAGE_INSTRUCTION);
        }
      } catch (err) {
        appendLog('system.transform', 'hook 失败', err);
      }
    },

    dispose: async () => {
      clearInterval(cleanupTimer);
      clearInterval(contextCleanupTimer);
    },
  };
};

export const server = CoHubPlugin;
export default CoHubPlugin;
