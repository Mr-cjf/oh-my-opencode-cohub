# oh-my-opencode-cohub

OpenCode 中文智能体编排插件。TypeScript ESM，通过 `@opencode-ai/plugin` SDK 注册 12 个代理 + 中文注入 + TUI 面板。

## 构建

```bash
npm run build
```

构建依赖系统安装的 `bun`（非项目 devDependency）。完整命令：
1. `bun build` 编译 `src/index.ts` + `src/tui.ts` → `dist/`（ESM）
2. `bun build` 编译 `src/cli/index.ts` → `dist/cli/`（ESM）
3. `tsc --emitDeclarationOnly` 生成 `.d.ts`

所有 `@opencode-ai/*`、`@opentui/*`、`zod` 均为 external，不打包进 dist。

## 源码结构

| 目录/文件 | 用途 |
|-----------|------|
| `src/index.ts` | 插件入口：注册 agent、config hook、tool hook、message transform |
| `src/tui.ts` | TUI 侧边栏面板（依赖 `@opentui/solid`） |
| `src/prompts/*.ts` | 12 个代理的中文提示词（导出 `const` 字符串，非 .md） |
| `src/instructions/chinese.ts` | 中文语言要求指令文本 |
| `src/config/loader.ts` | 读取 `~/.config/opencode/oh-my-opencode-cohub.json` |
| `src/task-manager/` | Background Job Board 追踪器 |
| `src/cli/` | `install` / `uninstall` 命令 |

## 代理命名

插件注册的代理名称均为 `co-` 前缀：`co-orchestrator`、`co-oracle`、`co-librarian`、`co-explorer`、`co-designer`、`co-fixer`、`co-observer`、`co-council`、`co-rule-user`、`co-rule-project`、`co-rule-app`、`co-planner`。

## 关键架构约定

- **双重注册**：代理同时通过 `return { agent }` 和 `config` hook 写入，确保兼容 HTTP 服务器模式
- **中文注入**：通过 `experimental.chat.system.transform` 推送中文指令，不走 `instructions` 字段
- **Background Job Board**：通过 `experimental.chat.messages.transform` 注入到 user 消息末尾
- **TaskTracker**：`tool.execute.before` 注册任务 → `tool.execute.after` 更新状态
- **TUI state 文件**：写入 `~/.local/share/opencode/storage/oh-my-opencode-cohub/`，TUI 面板每秒轮询

## 修改提示词

提示词在 `src/prompts/` 下为 TypeScript 字符串常量，修改后需 `npm run build`。

运行时覆盖优先级（高→低）：
1. `.opencode/oh-my-opencode-cohub/{agent}.md`（项目级文件替换）
2. `~/.config/opencode/oh-my-opencode-cohub/{agent}.md`（用户级文件替换）
3. `opencode.json` plugin config 中的 `overrides` 字段
4. 内置提示词（`src/prompts/`）

## 添加新代理

1. `src/prompts/new-agent.ts` — 导出提示词常量
2. `src/index.ts` — import + 加入 `agents` 数组 + `CHINESE_PROMPTS` 映射 + `DEFAULT_MODELS`
3. `src/tui.ts` — `DEFAULT_AGENTS()` 兜底列表
4. `npm run build`

## 注意

- `@opentui/solid` 和 `@opentui/core` 是 `optionalDependencies`，TUI 功能依赖它们，但主插件可独立运行
- 此项目本身无测试套件（`package.json` 无 `test` script）
- `dist/` 目录已加入 `.gitignore`，发布的包只包含 `dist/`
- `.opencode/` 目录是此项目**自身的** OpenCode 配置（开发环境用），与插件行为无关
