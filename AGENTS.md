# oh-my-opencode-cohub

OpenCode 中文智能体编排插件。TypeScript ESM，通过 `@opencode-ai/plugin` SDK 注册 12 个代理 + 中文注入 + TUI 面板。

## 代理清单

| Agent | 角色 |
|-------|------|
| `co-orchestrator` | 纯调度——分析需求→委派→审核 |
| `co-oracle` | 架构审查 / 代码审查 / YAGNI 简化 / 复杂调试 |
| `co-librarian` | 官方文档 / API / GitHub 研究（只读+Web） |
| `co-explorer` | 代码库搜索定位——grep / glob / AST（只读） |
| `co-designer` | UI/UX 设计实现 / 视觉润色 / 响应式布局（读写） |
| `co-fixer` | 代码修改 / 构建 / 测试执行（读写+Bash） |
| `co-observer` | 图片 / PDF / 截图视觉分析（只读） |
| `co-council` | 多模型并行共识（不可逆决策用） |
| `co-rule-user` | 用户级 `~/.config/opencode/AGENTS.md` 分析 |
| `co-rule-project` | 项目 `AGENTS.md` 分析 |
| `co-rule-app` | `.opencode/rules/*.md` 分析 |
| `co-planner` | 方案制定——综合需求+信息+规范输出任务分解 |

## 构建

**前提**：bun 必须系统安装（非项目 devDependency）。

```bash
npm run build
```

完整 4 步（`package.json` `build` script）：
1. `bun run scripts/generate-prompts.ts` — 将 `src/prompts/*.md` → `src/prompts/*.ts`
2. `bun build src/index.ts src/tui.ts --outdir dist --target node --format esm`（external 依赖见下方列表）
3. `bun build src/cli/index.ts --outdir dist/cli --target node --format esm`
4. `tsc --emitDeclarationOnly`

外部依赖不打包：`@opencode-ai/plugin`、`@opencode-ai/sdk`、`@opentui/core`、`@opentui/solid`、`zod`。
`dist/` 在 `.gitignore` 中。

## 源码地图

| 找什么 | 去哪里 |
|--------|--------|
| 插件入口（agent 注册、hook、消息转换） | `src/index.ts` |
| TUI 侧边栏面板 | `src/tui.ts` |
| 12 个代理提示词源文件（人工编辑） | `src/prompts/*.md` |
| 提示词自动生成文件（勿手动编辑） | `src/prompts/*.ts` |
| 提示词生成脚本 | `scripts/generate-prompts.ts` |
| 上下文共享系统 | `src/context/`（types / strategy / extractor / formatter / engine / extractor.test.ts） |
| 多模型共识工具 | `src/tools/council.ts` |
| CLI 安装/卸载 | `src/cli/`（index.ts / config-io.ts） |
| Background Job Board 追踪器 | `src/task-manager/`（types.ts / tracker.ts） |
| 用户配置文件加载 | `src/config/loader.ts` |
| 中文指令文本 | `src/instructions/chinese.ts` |

## 关键架构约定

- **双重注册**：代理同时通过 `return { agent }` 和 `config` hook 写入，确保兼容 HTTP 服务器模式
- **中文注入**：通过 `experimental.chat.system.transform` 推送中文指令，不走 `instructions` 字段
- **Background Job Board**：通过 `experimental.chat.messages.transform` 注入到 user 消息末尾
- **TaskTracker**：`tool.execute.before` 注册任务 → `tool.execute.after` 更新状态
- **TUI state**：写入 `~/.local/share/opencode/storage/oh-my-opencode-cohub/`，TUI 面板每 250ms 轮询

## 操作手册

### 修改提示词

⚠️ **编辑 `src/prompts/*.md`（Markdown 源文件）**，不要编辑 `src/prompts/*.ts`（自动生成，会被覆盖）。

运行时覆盖优先级（高→低）：
1. `.opencode/oh-my-opencode-cohub/{agent}.md`（项目级文件替换）
2. `~/.config/opencode/oh-my-opencode-cohub/{agent}.md`（用户级文件替换）
3. 内置提示词（`src/prompts/*.md`）

### 添加新代理（以 `co-foo` 为例）

必须修改 **5 个位置**，缺一不可：

| # | 操作 | 文件 |
|---|------|------|
| 1 | 创建提示词源文件 | `src/prompts/foo.md` |
| 2 | 注册到生成脚本 | `scripts/generate-prompts.ts` → `AGENTS` 数组 |
| 3 | 注册到插件入口（**4 处**）：import、`CHINESE_PROMPTS`、`agents` 数组、`loadFileOverrides` 的 `agentNames` | `src/index.ts` |
| 4 | 注册到 TUI 兜底列表 | `src/tui.ts` → `DEFAULT_AGENTS()` |
| 5 | 构建 | `npm run build`（自动执行 generate-prompts） |

### 运行测试

```bash
bun test
# 等效命令：npm run test
```

目前仅有 `src/context/extractor.test.ts` 一个测试文件。

### 发版

流程见 `.opencode/rules/发版规范.md`。关键步骤：
1. 更新 `CHANGELOG.md`
2. `npm version patch|minor|major`
3. 确保使用 SSH remote 后 `git push --follow-tags`（CI 自动构建并发布到 npm）

## 常见陷阱

| 陷阱 | 后果 | 正确做法 |
|------|------|---------|
| 直接编辑 `src/prompts/*.ts` | 下次 `npm run build` 覆盖修改 | 编辑 `src/prompts/*.md` 后 `npm run build` |
| 添加代理忘记更新 `scripts/generate-prompts.ts` | `.md` 不会生成 `.ts`，构建报错 | 步骤 2 不可跳过 |
| 添加代理只改 1 处 `src/index.ts` 位置 | 代理不生效或 `loadFileOverrides` 漏掉 | `src/index.ts` 中需改 **4 处** |
| 系统未安装 bun | `npm run build` 失败 | `npm install -g bun` 或使用系统的 bun |
| 忘记 `git push --follow-tags` | tag 未推送，CI 不触发 npm 发布 | 发版步骤 3 不可遗漏 |
| 在 `master`/`test`/`dev` 分支执行 git 提交技能 | 违反分支保护约定 | 仅在功能分支使用提交和发版技能 |

## 外部依赖与配置

- **运行依赖**：`@opencode-ai/plugin`、`@opencode-ai/sdk`
- **可选依赖**：`@opentui/solid`、`@opentui/core`（仅 TUI 需要）
- **devDependencies**：`typescript`、`@types/node`
- **插件标记**：`package.json` 中 `"opencode": { "plugin": true }`
- **用户配置**：运行时从 `~/.config/opencode/oh-my-opencode-cohub.json` 加载
