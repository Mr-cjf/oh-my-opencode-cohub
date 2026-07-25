import type { TuiPluginModule } from '@opencode-ai/plugin/tui';
import { jsx } from '@opentui/solid/jsx-runtime';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
  } catch { return DEFAULT_AGENTS(); }
}

/** 硬编码兜底——cohub-state.json 未生成时使用 */
function DEFAULT_AGENTS(): AgentInfo[] {
  const list: [string, string][] = [
    ['co-orchestrator', 'deepseek/deepseek-v4-pro'],
    ['co-oracle', 'deepseek/deepseek-v4-pro'],
    ['co-librarian', 'deepseek/deepseek-v4-flash'],
    ['co-explorer', 'deepseek/deepseek-v4-flash'],
    ['co-designer', 'minimax/MiniMax-M3'],
    ['co-fixer', 'deepseek/deepseek-v4-flash'],
    ['co-observer', 'codermxtest/gpt-5.5'],
    ['co-council', 'deepseek/deepseek-v4-pro'],
    ['co-rule-user', 'deepseek/deepseek-v4-flash'],
    ['co-rule-project', 'deepseek/deepseek-v4-flash'],
    ['co-rule-app', 'deepseek/deepseek-v4-flash'],
    ['co-planner', 'deepseek/deepseek-v4-pro'],
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
  } catch { return null; }
}

const plugin: TuiPluginModule = {
  id: 'oh-my-opencode-cohub:tui',
  tui: async (api, _options) => {
    const theme = api.theme.current;
    let spinnerIndex = 0;
    let state = readState();

    // 每秒轮询状态 + 动画帧
    const timer = setInterval(() => {
      state = readState();
      spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
      api.renderer.requestRender();
    }, 250);

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
      clearInterval(timer);
    });
  },
};

export default plugin;
