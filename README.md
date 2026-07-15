# oh-my-opencode-cohub

OpenCode 中文智能体编排插件 CoHub——纯调度模式、全中文提示词、规范分析代理、方案制定代理。

[![GitHub](https://img.shields.io/badge/GitHub-Mr--cjf%2Foh--my--opencode--cohub-blue?logo=github)](https://github.com/Mr-cjf/oh-my-opencode-cohub)

## 特性

- 🚀 **独立运行**：纯 OpenCode Plugin，依赖 `@opencode-ai/plugin` SDK，零外部插件依赖
- 🤖 **12 个内置代理**：8 个通用代理（orchestrator/oracle/librarian/explorer/designer/fixer/observer/council）+ 4 个规范/方案代理（rule-user/rule-project/rule-app/planner）
- 🪝 **自动注入**：通过 `system.transform` 钩子在每次 LLM 调用时注入中文语言要求
- 🧠 **纯调度 Orchestrator**：不碰任何文件工具，只负责规划、委派、验证
- 🇨🇳 **全中文提示词**：12 个代理全部使用中文提示词
- 📋 **规范分析代理**：rule-user（用户AGENTS.md）、rule-project（项目AGENTS.md）、rule-app（.opencode/rules/）
- 🎯 **方案制定代理**：planner 综合所有输入输出结构化任务分解
- 🔗 **OpenSpec + Superpowers 死板路由**：收到需求即触发，不判断"大小"
- ⚡ **六步工作流**：理解→收集→规范分析→制定方案→调度→验证
- 📜 **AGENTS.md 全覆盖**：项目级和用户级 AGENTS.md 对**本插件所有代理**（内置 8 个 + 插件 4 个）均生效，无需额外配置
- 📖 **架构借鉴**：插件架构和代理编排理念借鉴了 oh-my-opencode-slim，但完全独立实现、无运行时依赖

## 安装

### 前置条件

- [OpenCode](https://opencode.ai) 已安装
- 推荐安装 [Bun](https://bun.sh)（CLI 一键安装需要）

### 方式一：CLI 一键安装（推荐）

```bash
bunx oh-my-opencode-cohub install
```

CLI 会自动完成以下操作：

1. 将 `oh-my-opencode-cohub` 注册到 `~/.config/opencode/opencode.json` 的 `plugin` 数组
2. 将插件注册到 TUI 配置 `~/.config/opencode/tui.json`
3. 在 `opencode.json` 的 `agent` 字段中注册全部 12 个 `co-*` 代理
4. 写入默认配置文件 `~/.config/opencode/oh-my-opencode-cohub.json`

重启 OpenCode 即可生效。

### 方式二：npm 安装 + 手动配置

```bash
npm install oh-my-opencode-cohub
```

然后在 `~/.config/opencode/opencode.json` 中添加：

```json
{
  "plugin": ["oh-my-opencode-cohub"]
}
```

重启 OpenCode 即可。

### 卸载

```bash
bunx oh-my-opencode-cohub uninstall
```

CLI 会精确清理所有 `co-*` 代理和相关配置，不影响其他插件的配置数据。

如果使用 npm 手动安装，则需手动从 `opencode.json` 的 `plugin` 数组中移除 `"oh-my-opencode-cohub"`，然后 `npm uninstall oh-my-opencode-cohub`。

### 验证安装

安装并重启 OpenCode 后，确认以下效果：

- 对话中自动出现 **中文语言要求**（如 "你必须始终使用中文进行思考、推理和回复"）
- 可用代理列表中出现 12 个 `co-*` 前缀代理（`co-orchestrator`、`co-oracle`、`co-librarian`、`co-explorer`、`co-designer`、`co-fixer`、`co-observer`、`co-council`、`co-rule-user`、`co-rule-project`、`co-rule-app`、`co-planner`）
- Orchestrator 自动进入纯调度模式（只做规划、委派、验证，不直接操作文件）

### 从源码安装（本地开发）

如果需要修改源码或使用开发版本：

```bash
# 1. 克隆项目
git clone https://github.com/Mr-cjf/oh-my-opencode-cohub.git && cd oh-my-opencode-cohub

# 2. 安装依赖
npm install

# 3. 构建（需要系统已安装 Bun）
npm run build

# 4. 方式 A：npm link 全局链接（推荐）
npm link
bunx oh-my-opencode-cohub install
# 重启 OpenCode 即可。之后修改源码只需重新 npm run build

# 4. 方式 B：手动配置绝对路径
# 编辑 ~/.config/opencode/opencode.json，在 plugin 数组中写入项目绝对路径：
# { "plugin": ["/absolute/path/to/oh-my-opencode-cohub"] }
# 然后手动运行 CLI 注册代理：
# node dist/cli/index.js install
```

> **构建依赖**：`npm run build` 使用 `bun build` 和 `tsc`。系统需安装 [Bun](https://bun.sh)（构建工具）和 Node.js（类型声明生成）。所有 `@opencode-ai/*`、`@opentui/*`、`zod` 均为 external，不打包进 `dist/`。

## 代理一览

### 代理（12 个，全中文提示词）

| 代理 | 默认模型 | 职责 | 读取源 |
|------|----------|------|--------|
| co-orchestrator | `deepseek/deepseek-v4-pro` | 纯调度：规划→委派→验证 | — |
| co-oracle | `deepseek/deepseek-v4-pro` | 架构审查/代码审查（含 Superpowers skills） | — |
| co-librarian | `deepseek/deepseek-v4-flash` | 外部文档/API 研究 | — |
| co-explorer | `deepseek/deepseek-v4-flash` | 代码库搜索定位 | — |
| co-designer | `minimax/MiniMax-M3` | UI/UX 设计与实现 | — |
| co-fixer | `deepseek/deepseek-v4-flash` | 代码修改执行（含 TDD skill） | — |
| co-observer | `codermxtest/gpt-5.5` | 图片/PDF 分析 | — |
| co-council | `deepseek/deepseek-v4-pro` | 多模型共识 | — |
| co-rule-user | `deepseek/deepseek-v4-flash` | 用户级规范分析 | `~/.config/opencode/AGENTS.md` |
| co-rule-project | `deepseek/deepseek-v4-flash` | 项目级规范分析 | 项目 `AGENTS.md` |
| co-rule-app | `deepseek/deepseek-v4-flash` | 应用规则分析 | `.opencode/rules/*.md` |
| co-planner | `deepseek/deepseek-v4-pro` | 方案制定 | 综合需求+信息+规则 |

> 模型可通过下文「配置文件」或「自定义模型」章节覆盖。

## 配置文件

CLI 安装后自动创建 `~/.config/opencode/oh-my-opencode-cohub.json`，这是 CoHub 的专用配置文件，结构如下：

```json
{
  "$schema": "https://unpkg.com/oh-my-opencode-cohub@latest/oh-my-opencode-cohub.schema.json",
  "agents": {
    "co-orchestrator": { "model": "deepseek/deepseek-v4-pro", "variant": "max" },
    "co-oracle":      { "model": "deepseek/deepseek-v4-pro", "variant": "max" },
    "co-librarian":   { "model": "deepseek/deepseek-v4-flash", "variant": "low" },
    "co-explorer":    { "model": "deepseek/deepseek-v4-flash", "variant": "low" },
    "co-designer":    { "model": "minimax/MiniMax-M3", "variant": "medium" },
    "co-fixer":       { "model": "deepseek/deepseek-v4-flash", "variant": "high" },
    "co-observer":    { "model": "codermxtest/gpt-5.5", "variant": "low" },
    "co-council":     { "model": "deepseek/deepseek-v4-pro", "variant": "high" },
    "co-rule-user":   { "model": "deepseek/deepseek-v4-flash", "variant": "medium" },
    "co-rule-project":{ "model": "deepseek/deepseek-v4-flash", "variant": "medium" },
    "co-rule-app":    { "model": "deepseek/deepseek-v4-flash", "variant": "medium" },
    "co-planner":     { "model": "deepseek/deepseek-v4-pro", "variant": "high" }
  }
}
```

直接编辑此文件即可修改任意代理的模型和变体。`$schema` 提供 IDE 自动补全支持。

> **注意**：同一目录 `~/.config/opencode/oh-my-opencode-cohub/` 下也可放置 `{agent}.md` 提示词覆盖文件（见「自定义提示词」章节），与 JSON 配置文件共存。

## 工作流

```
1. 理解需求
2. 信息收集（@co-explorer / @co-librarian / @co-observer）
3. 规范分析（并行 @co-rule-user / @co-rule-project / @co-rule-app）
4. 制定方案 → @co-planner
5. 调度执行（@co-fixer / @co-designer 等）
6. 验证（@co-oracle / @co-designer）
```

## 依赖

- [OpenCode](https://opencode.ai) ≥ 1.17
- `@opencode-ai/plugin@^1.17`（运行时依赖）
- `@opencode-ai/sdk@^1.3`（运行时依赖）
- 无其他外部插件依赖

## 自定义模型

**推荐**：直接编辑 `~/.config/opencode/oh-my-opencode-cohub.json`（见「配置文件」章节），修改对应代理的 `model` 和 `variant` 即可。

**备选**：通过 `opencode.json` 的 plugin config 覆盖：

```json
{
  "plugin": [
    {
      "name": "oh-my-opencode-cohub",
      "config": {
        "models": {
          "orchestrator": "openai/gpt-5.5",
          "fixer": "openai/gpt-5.4-mini"
        }
      }
    }
  ]
}
```

> 注意：plugin config 中的 key 使用无 `co-` 前缀的短名（如 `orchestrator`）；JSON 配置文件使用完整的 `co-` 前缀名（如 `co-orchestrator`）。

## 自定义提示词

### 方式一：通过 plugin config 覆盖（推荐）

在 `opencode.json` 的 plugin config 中传入自定义 prompt：

```json
{
  "plugin": [
    {
      "name": "oh-my-opencode-cohub",
      "config": {
        "overrides": {
          "oracle": "你是我的自定义 Oracle 代理——负责代码审查和安全审计……",
          "fixer": "你是我的自定义 Fixer 代理——只做 Python 代码修改……"
        }
      }
    }
  ]
}
```

支持覆盖的代理名称：`orchestrator`、`oracle`、`librarian`、`explorer`、`designer`、`fixer`、`observer`、`council`、`rule-user`、`rule-project`、`rule-app`、`planner`

### 方式二：文件覆盖（类 oh-my-opencode-slim 机制）

在项目 `.opencode/oh-my-opencode-cohub/` 或 `~/.config/opencode/oh-my-opencode-cohub/` 目录下创建 `{agent}.md` 文件：

```
oh-my-opencode-cohub/
├── oracle.md          ← 完全替换 oracle 提示词
├── fixer_append.md    ← 追加到 fixer 提示词末尾
└── planner.md         ← 完全替换 planner 提示词
```

文件名规则：
- `{agent}.md` —— 完全替换该代理的内置提示词
- `{agent}_append.md` —— 追加内容到内置提示词末尾

查找优先级：项目 `.opencode/` > `~/.config/opencode/`

### 方式三：Fork 并修改源码

```bash
# 修改 src/prompts/oracle.ts 并重新编译
npm run build
```

适合深度定制，但需维护自己的分支。

## 许可证

MIT
