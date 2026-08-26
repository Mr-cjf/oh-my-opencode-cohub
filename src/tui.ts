import type { TuiPluginModule } from '@opencode-ai/plugin/tui';
import { jsx } from '@opentui/solid/jsx-runtime';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { appendLog } from './utils/log.js';

/** 从用户配置文件动态读取 agent 配置 */
const AGENT_CONFIG_FILE = path.join(os.homedir(), '.config', 'opencode', 'oh-my-opencode-cohub.json');

interface AgentInfo { name: string; description: string; model: string; variant: string | null; provider: string; }

function loadAgentConfig(): AgentInfo[] {
  try {
    if (!fs.existsSync(AGENT_CONFIG_FILE)) return DEFAULT_AGENTS();
    const data = JSON.parse(fs.readFileSync(AGENT_CONFIG_FILE, 'utf-8'));
    const agents = data.agents as Record<string, { model: string; variant?: string }>;
    if (!agents) return DEFAULT_AGENTS();
    return Object.entries(agents).map(([name, cfg]) => {
      const model = cfg.model ?? '';
      const parts = model.split('/');
      const provider = parts.length > 1 ? parts[0] : 'default';
      const shortModel = parts.length > 1 ? parts.slice(1).join('/') : model;
      return {
        name,
        description: model,
        model: shortModel,
        variant: cfg.variant ?? null,
        provider,
      };
    });
  } catch (err) {
    appendLog('tui.loadAgentConfig', '读取代理配置失败，使用默认值', err);
    return DEFAULT_AGENTS();
  }
}

/** 硬编码兜底——cohub-state.json 未生成时使用 */
function DEFAULT_AGENTS(): AgentInfo[] {
  const list: [string, string][] = [
    ['co-orchestrator', 'deepseek/deepseek-v4-pro'],
    ['co-oracle', 'deepseek/deepseek-v4-flash'],
    ['co-librarian', 'deepseek/deepseek-v4-flash'],
    ['co-explorer', 'deepseek/deepseek-v4-flash'],
    ['co-designer', 'minimax/MiniMax-M3'],
    ['co-fixer', 'deepseek/deepseek-v4-flash'],
    ['co-observer', 'codermxtest/gpt-5.5'],
    ['co-council', 'deepseek/deepseek-v4-flash'],
    ['co-rule-user', 'deepseek/deepseek-v4-flash'],
    ['co-rule-project', 'deepseek/deepseek-v4-flash'],
    ['co-rule-app', 'deepseek/deepseek-v4-flash'],
    ['co-planner', 'deepseek/deepseek-v4-flash'],
  ];
  return list.map(([name, fullModel]) => {
    const parts = fullModel.split('/');
    return {
      name,
      description: name,
      provider: parts[0],
      model: parts.slice(1).join('/'),
      variant: null,
    };
  });
}

const STATE_FILE = path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'oh-my-opencode-cohub', 'tracker-state.json');

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function readState(): { runningAgents: string[]; runningCount: number } | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch (err) {
    appendLog('tui.readState', '读取状态文件失败', err);
    return null;
  }
}

const plugin: TuiPluginModule = {
  id: 'oh-my-opencode-cohub:tui',
  tui: async (api, _options) => {
    const theme = api.theme.current;
    let spinnerIndex = 0;
    let state = readState();

    // 轮询退避：空闲 250ms → 1s → 2s → 5s 封顶；收到事件立即恢复 250ms 并重置退避
    const POLL_INTERVALS = [250, 1000, 2000, 5000] as const;
    let pollStep = 0;
    let lastEventAt = 0;
    let lastSnapshot = JSON.stringify(state);
    let timer: ReturnType<typeof setTimeout>;

    const pollTick = () => {
      const nextState = readState();
      const snapshot = JSON.stringify(nextState);
      if (snapshot !== lastSnapshot) {
        // 状态文件内容变化 → 视为收到事件：立即恢复 250ms 并重置退避计数
        lastSnapshot = snapshot;
        lastEventAt = Date.now();
        pollStep = 0;
      } else {
        // 空闲退避：指数递增至 5s 封顶
        pollStep = Math.min(pollStep + 1, POLL_INTERVALS.length - 1);
      }
      state = nextState;
      api.renderer.requestRender();
      timer = setTimeout(pollTick, POLL_INTERVALS[pollStep]);
    };
    timer = setTimeout(pollTick, POLL_INTERVALS[0]);

    // P2-6: spinner 动画由独立 100ms 定时器驱动，不受 readState 轮询退避影响
    //（退避到 5s 时动画仍流畅；无运行任务时不触发渲染）
    const spinnerTimer = setInterval(() => {
      spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
      if (state && state.runningCount > 0) api.renderer.requestRender();
    }, 100);

    api.slots.register({
      order: 800,
      slots: {
        sidebar_content() {
          const runningSet = new Set(state?.runningAgents ?? []);
          const runningCount = state?.runningCount ?? 0;
          const spinner = SPINNER_FRAMES[spinnerIndex];

          return jsx('box', {
            width: '100%',
            flexDirection: 'column',
            padding: { top: 1, bottom: 1, left: 1, right: 1 },
            children: [
              // ===== 标题行 =====
              jsx('box', {
                width: '100%',
                flexDirection: 'row',
                justifyContent: 'space-between',
                children: [
                  jsx('box', {
                    bg: theme.backgroundPanel,
                    border: { type: 'single' },
                    borderColor: theme.accent,
                    padding: { left: 1, right: 1 },
                    children: jsx('text', { fg: theme.accent, bold: true, children: 'CoHub' }),
                  }),
                  jsx('text', { fg: theme.textMuted, dim: true, children: 'v1.0' }),
                ],
              }),
              jsx('box', { height: 1 }),

              // ===== Agents 分组 =====
              jsx('text', { fg: theme.text, bold: true, children: 'Agents' }),
              ...loadAgentConfig().map(a => {
                const isRunning = runningSet.has(a.name);
                return jsx('box', {
                  width: '100%',
                  flexDirection: 'column',
                  padding: { left: 1 },
                  children: [
                    // Agent 名 + 状态指示器
                    jsx('box', {
                      flexDirection: 'row',
                      children: [
                        jsx('text', { fg: isRunning ? theme.accent : theme.text, bold: isRunning, children: a.name }),
                        isRunning ? jsx('text', { fg: theme.accent, children: ` ${spinner}` }) : null,
                      ],
                    }),
                    jsx('box', {
                      flexDirection: 'row',
                      padding: { left: 2 },
                      children: [
                        jsx('text', { fg: theme.textMuted, width: '30%', dim: true, children: 'provider' }),
                        jsx('text', { fg: theme.textMuted, dim: true, children: a.provider }),
                      ],
                    }),
                    jsx('box', {
                      flexDirection: 'row',
                      padding: { left: 2 },
                      children: [
                        jsx('text', { fg: theme.textMuted, width: '30%', dim: true, children: 'model' }),
                        jsx('text', { fg: theme.textMuted, dim: true, children: a.model }),
                      ],
                    }),
                    a.variant
                      ? jsx('box', {
                          flexDirection: 'row',
                          padding: { left: 2 },
                          children: [
                            jsx('text', { fg: theme.textMuted, width: '30%', dim: true, children: 'variant' }),
                            jsx('text', { fg: theme.textMuted, dim: true, children: a.variant }),
                          ],
                        })
                      : null,
                  ],
                });
              }),
              jsx('box', { height: 1 }),

              // ===== 状态 =====
              runningCount > 0
                ? jsx('text', { fg: theme.accent, children: `${spinner} ${runningCount} 任务运行中` })
                : jsx('text', { fg: theme.success, children: '✓ 已激活 · 纯调度模式' }),
            ],
          });
        },
      },
    });

    api.lifecycle.onDispose(() => {
      clearTimeout(timer);
      clearInterval(spinnerTimer);
    });
  },
};

export default plugin;
