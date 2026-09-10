# oh-my-opencode-cohub

OpenCode 中文智能体编排插件 CoHub——纯调度模式、全中文提示词、编排引擎、上下文共享、规范分析代理、方案制定代理。

[![GitHub](https://img.shields.io/badge/GitHub-Mr--cjf%2Foh--my--opencode--cohub-blue?logo=github)](https://github.com/Mr-cjf/oh-my-opencode-cohub)

## 特性

- 🚀 **独立运行**：纯 OpenCode Plugin，依赖 `@opencode-ai/plugin` SDK，零外部插件依赖
- 🤖 **12 个内置代理**：8 个通用代理（orchestrator/oracle/librarian/explorer/designer/fixer/observer/council）+ 4 个规范/方案代理（rule-user/rule-project/rule-app/planner）
- 🪝 **自动注入**：通过 `system.transform` 钩子在每次 LLM 调用时注入中文语言要求
- 🧠 **纯调度 Orchestrator**：不碰任何文件工具，只负责规划、委派、验证
- 🇨🇳 **全中文提示词**：12 个代理全部使用中文提示词
- 📋 **规范分析代理**：rule-user（用户AGENTS.md）、rule-project（项目AGENTS.md）、rule-app（.opencode/rules/）
- 🎯 **方案制定代理**：planner 综合所有输入输出结构化任务分解
- 🔗 **编排引擎（Orchestration Engine）**：六状态 DAG 状态机（pending→ready→running→completed/failed→cancelled）、级联取消、按代理配置的自动重试（指数退避/fixed/immediate）、全局并发调度（maxConcurrency=20）
- ⚡ **Wave 波次并行工作流**：理解→收集→规范分析→制定方案（按依赖分 Wave）→按波次并行调度（区分修改/验证 Wave）→验证，编排引擎代码级保障执行可靠
- 📜 **AGENTS.md 专用分析代理**：co-rule-user / co-rule-project / co-rule-app 三个专用代理分别分析用户级/项目级 AGENTS.md 与 .opencode/rules，orchestrator 在方案制定前自动委派，分析结果注入执行上下文
- 📖 **架构借鉴**：插件架构和代理编排理念借鉴了 oh-my-opencode-slim，但完全独立实现、无运行时依赖

## 安装

### 前置条件

- [OpenCode](https://opencode.ai) 已安装
- [Bun](https://bun.sh) 已安装（CLI 安装和源码构建均需要）

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

### 方式三：复制文案交给 AI 配置

如果你不想用命令行，也可以复制以下文案粘贴给 AI，让 AI 帮你生成 `oh-my-opencode-cohub.json` 配置文件。

> **注意：这只生成 `oh-my-opencode-cohub.json`（代理模型配置）。插件本身仍需通过方式一或方式二安装。**

````

## 你的任务

帮我生成 oh-my-opencode-cohub 的配置文件。

**要求：收到后先分析我的环境、输出配置方案表格、等我确认后再写入文件，不要直接动手改。**

## 执行步骤

### 第一步：分析环境

读取 `~/.config/opencode/opencode.json`，找到所有已配置的 provider 和 model，整理成表格给我看。

### 第二步：输出配置方案

根据下面规则，输出每个代理的 model 和 variant 分配表格，等我确认。

### 第三步：写入文件

确认后将配置写入 `~/.config/opencode/oh-my-opencode-cohub.json`。

## 配置文件结构

```json
{
  "$schema": "https://unpkg.com/oh-my-opencode-cohub@latest/oh-my-opencode-cohub.schema.json",
  "agents": {
    "co-orchestrator": { "model": "provider/model", "variant": "max" },
    ...
  },
  "council": {
    "default_preset": "default",
    "timeout": 180000,
    "councillor_execution_mode": "parallel",
    "councillor_retries": 3,
    "presets": {
      "default": {
        "alpha": { "model": "provider/model", "variant": "max" },
        "beta":  { "model": "provider/model", "variant": "high" },
        "gamma": { "model": "provider/model", "variant": "medium" }
      }
    }
  }
}
```

## 12 个代理配置规则

| 代理 | 角色 | 推理强度 | variant 建议 | 模型偏好 |
|------|------|---------|-------------|---------|
| co-orchestrator | 纯调度者，编排任务、委派执行 | **重型** | max / xhigh | pro、max、sonnet、opus 等强推理模型 |
| co-oracle | 战略顾问，架构审查、复杂调试 | **轻型** | low / medium | flash、mini、haiku 等轻量快速模型 |
| co-planner | 方案制定，综合信息输出任务分解 | **轻型** | low / medium | 同上 |
| co-council | 多模型共识，跨多个 LLM 综合 | **轻型** | low / medium | 同上 |
| co-librarian | 研究员，查文档、搜 GitHub、Web 搜索 | **轻型** | low / medium | flash、mini、haiku 等轻量快速模型 |
| co-explorer | 代码探索者，grep/glob 搜索定位 | **轻型** | low / medium | 同上 |
| co-fixer | 执行者，代码修改、编译、测试 | **轻型** | low / medium | 同上 |
| co-rule-user | 分析用户级 AGENTS.md 规范 | **轻型** | low / medium | 同上 |
| co-rule-project | 分析项目 AGENTS.md 规范 | **轻型** | low / medium | 同上 |
| co-rule-app | 分析 .opencode/rules/* 应用规则 | **轻型** | low / medium | 同上 |
| co-designer | 设计师，UI/UX 设计、视觉润色 | **中等** | high / medium | sonnet、claude、minimax 等前端/视觉强的模型 |
| co-observer | 观察者，图片/PDF/截图视觉分析 | **中等** | medium / high | vision、flash 等支持视觉的模型 |

## council 详细说明

council 是内置的多模型共识机制，会将同一个问题发给 3 个 councillor 并行回答，然后综合出最优方案。

| councillor | 角色定位 | 推理强度 | variant 建议 |
|-----------|---------|---------|-------------|
| alpha | 主力深度推理 | **重型** | max / xhigh |
| beta | 第二视角互补 | **重型/中等** | high / xhigh |
| gamma | 第三方校验 | **中等** | medium / high |

**关键配置项说明：**

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `default_preset` | `"default"` | 默认使用的 preset 名称，可以定义多个 preset（如 `"quick"` 快速共识、`"deep"` 深度共识） |
| `timeout` | `180000`（3 分钟） | 单个 councillor 的超时时间（毫秒），所有 councillor 并行执行 |
| `councillor_execution_mode` | `"parallel"` | 执行模式：`"parallel"` 并行（快）或 `"serial"` 串行（省 tokens） |
| `councillor_retries` | `3` | 单个 councillor 调用失败后的重试次数 |

**presets 示例（多套配置）：**

```json
"presets": {
  "default": {
    "alpha": { "model": "deepseek/deepseek-v4-pro", "variant": "max" },
    "beta":  { "model": "anthropic/claude-sonnet-4-20250514", "variant": "high" },
    "gamma": { "model": "openai/gpt-5.2", "variant": "high" }
  },
  "quick": {
    "alpha": { "model": "deepseek/deepseek-v4-pro", "variant": "high" },
    "beta":  { "model": "openai/gpt-5.2", "variant": "medium" },
    "gamma": { "model": "anthropic/claude-sonnet-4-20250514", "variant": "medium" }
  }
}
```

## 分配规则

- 从 opencode.json 读取已配置的 provider，按上表规则为每个代理分配 model 和 variant
- 只有 1 个 provider：所有代理都用它，variant 按表格建议选不同档位
- 有多个 provider：co-orchestrator 优先选最强推理 provider，其余代理选最快 provider
- council 的 alpha/beta/gamma 优先选 3 个不同 provider；不够 3 个时用同一 provider 的不同 model
- opencode.json 无任何 provider 时，生成占位配置并在 `_comment` 字段提示用户先配置

## 注意

- 只写入 `oh-my-opencode-cohub.json`，不要修改 `opencode.json`
- agent 名必须用 `co-` 前缀（共 12 个），不要遗漏
````

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

### 故障排查：代理模型未生效？

如果重启后代理可见但 model/variant 未应用，或子代理仍然不可见，复制以下文案交给 AI 自动诊断修复：

> **适用场景**：`@` 列表中缺少某些 co-* 代理，或代理使用的 model 与预期不符。

````
## 你的任务

帮我在当前环境中诊断并修复 oh-my-opencode-cohub 的代理配置问题。

**诊断步骤（按顺序执行，执行完向我报告结果）：**

### 第一步：检查 opencode.json 的 agent 条目

读取 `~/.config/opencode/opencode.json`，检查 `agent` 字段中是否存在以下 12 个条目：
- co-orchestrator (mode: primary) + 其余 11 个 (mode: subagent)

如果缺少某些条目，说明插件未正确安装，运行以下命令重新安装：
```bash
bun pm cache rm && bunx oh-my-opencode-cohub@latest install
```

### 第二步：检查 model/variant 配置

读取 `~/.config/opencode/oh-my-opencode-cohub.json`，确认 `agents` 字段下每个代理都有 `model` 和 `variant`。

如果 agent 条目有 model 但 opencode.json 中缺少 model，手动将 model/variant 补入 opencode.json 对应条目：
```json
"co-explorer": {
  "mode": "subagent",
  "description": "...",
  "model": "deepseek-anthropic/deepseek-v4-flash",
  "variant": "low"
}
```

### 第三步：验证 config hook（仅诊断）

检查 `~/.local/share/opencode/storage/oh-my-opencode-cohub/config-hook-ran.json` 是否存在且 `count` 为 12。如果不存在或 count < 12，说明插件未正常加载，检查：
- opencode.json 的 `plugin` 数组是否包含 `"oh-my-opencode-cohub"`
- OpenCode 版本是否 >= 1.17

### 第四步：最终修复

如果以上检查都通过但代理仍无 model/variant，执行完整重装：
```bash
bunx oh-my-opencode-cohub uninstall && bun pm cache rm && bunx oh-my-opencode-cohub@latest install
```
重启 OpenCode 后验证。

### 第五步：验证修复

请确认以下内容后告诉我结果：
- TAB 切换列表中有 co-orchestrator
- `@` 输入时能看到至少 11 个子代理名称
- 随便 @ 某个子代理（如 `@co-explorer 搜索src目录`），确认它能正常工作
````

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

> **构建步骤**：`npm run build` 依次执行：1) `scripts/generate-prompts.ts` 将提示词文件生成 `src/prompts/*.ts` 导出模块；2) `bun build` 编译 `src/index.ts` + `src/tui.ts` → `dist/` 以及 `src/cli/index.ts` → `dist/cli/`；3) `tsc --emitDeclarationOnly` 生成 `.d.ts`。系统需安装 [Bun](https://bun.sh) 和 Node.js。所有 `@opencode-ai/*`、`@opentui/*`、`zod` 均为 external，不打包进 `dist/`。

## 代理一览

### 代理（12 个，全中文提示词）

| 代理 | 默认模型 | 职责 | 读取源 |
|------|----------|------|--------|
| co-orchestrator | `deepseek/deepseek-v4-pro` | 纯调度：规划→委派→验证 | — |
| co-oracle | `deepseek/deepseek-v4-flash` | 架构审查/代码审查 | — |
| co-librarian | `deepseek/deepseek-v4-flash` | 外部文档/API 研究 | — |
| co-explorer | `deepseek/deepseek-v4-flash` | 代码库搜索定位 | — |
| co-designer | `minimax/MiniMax-M3` | UI/UX 设计与实现 | — |
| co-fixer | `deepseek/deepseek-v4-flash` | 代码修改执行（含 TDD skill） | — |
| co-observer | `codermxtest/gpt-5.5` | 图片/PDF 分析 | — |
| co-council | `deepseek/deepseek-v4-flash` | 多模型共识 | — |
| co-rule-user | `deepseek/deepseek-v4-flash` | 用户级规范分析 | `~/.config/opencode/AGENTS.md` |
| co-rule-project | `deepseek/deepseek-v4-flash` | 项目级规范分析 | 项目 `AGENTS.md` |
| co-rule-app | `deepseek/deepseek-v4-flash` | 应用规则分析 | `.opencode/rules/*.md` |
| co-planner | `deepseek/deepseek-v4-flash` | 方案制定 | 综合需求+信息+规则 |

> **注意**：上表模型为内置兜底值。安装时 CLI 会根据 `opencode.json` 中已配置的 provider 智能匹配并写入 `oh-my-opencode-cohub.json`；若 `opencode.json` 无 provider 则生成占位配置。最终生效模型以 `oh-my-opencode-cohub.json` 为准，也可通过下文「配置文件」或「自定义模型」章节手动覆盖。
>
> **工具权限**：`close_job` 仅 co-orchestrator 可调用；`council_session` 仅 co-council 可调用；其余代理配置层 deny，纵深防御。

## 编排引擎

CoHub 内置轻量编排引擎（`src/orchestration/`，6 模块），通过代码级保障 orchestrator 的编排可靠性，而非仅靠 prompt 约束：

| 组件 | 文件 | 职责 |
|------|------|------|
| 状态机引擎 | `engine.ts` | 六状态 DAG：`pending→ready→running→completed/failed/cancelled`，依赖自动检查、级联取消 |
| 重试管理器 | `retry.ts` | 按代理配置重试策略（指数退避 / fixed / immediate）、可重试错误白名单；降级路由字段已预留 |
| 上下文契约 | `contract.ts` | `<!-- CONTRACT_BEGIN/END -->` 结构化块：关键结果 / 决策 / 修改文件 / 验证状态 / 待完成 / 警告，子代理间传递并自动去重 |
| 并发调度器 | `scheduler.ts` | 全局并发上限 `maxConcurrency=20`，DAG 依赖自然控制实际并行度 |

### 关键工具

| 工具 | 可用代理 | 功能 |
|------|---------|------|
| `close_job` | 仅 co-orchestrator | 按 Session ID 或任务别名中止卡住的子代理后台任务（`session.abort` + 状态同步） |
| `council_session` | 仅 co-council | 多模型并行/串行共识：共识检测、重试决策、质量门禁、退避降级 |

### 上下文共享

ContextEngine（`src/context/`）按四种策略自动向子代理注入上下文：

| 策略 | 适用代理 | 注入内容 |
|------|---------|---------|
| `none` | explorer / librarian / observer / rule-* | 不注入上下文，减少干扰 |
| `relevant` | fixer / designer / planner | 相关文件路径 + 前置决策 + 近期错误 |
| `summary` | oracle / council | 同上，且文件正文按 token 预算（2000）截断后注入 |
| `full` | （预留） | 完整正文，目前未分配代理 |

### 注入膨胀防护

- **prompt 预算兜底**：拼接超 12,000 token 时降级为裸用户 prompt，防止 JSON 超长截断
- **CONTRACT 去重**：`stripExistingContracts` 清理历史残留契约块
- **错误截断**：单条 ≤200 字符 + 渲染总量 ≤600
- **Job Board 折叠**：展示上限 15 条 + `pruneTerminalJobs` 每 30 分钟清理终态任务

### 质量回送

`quality.ts` 轻量启发式判定：输出非空 + exit 正常 + 无错误关键词（含否定短语感知）+ decisions ≥ 1，四项各 0.25 分。低分仅标记不改变成败判定，供后续调度参考。

### 任务统计

CLI 提供 `stats` 子命令，展示任务成功率 / 平均延迟 / 平均 token：

```bash
bunx oh-my-opencode-cohub stats [N]    # 查看最近 N 个任务统计（默认 50）
```

## 配置文件

CLI 安装后自动创建 `~/.config/opencode/oh-my-opencode-cohub.json`，这是 CoHub 的专用配置文件，结构如下：

```json
{
  "$schema": "https://unpkg.com/oh-my-opencode-cohub@latest/oh-my-opencode-cohub.schema.json",
  "agents": {
    "co-orchestrator": { "model": "deepseek/deepseek-v4-pro", "variant": "max" },
    "co-oracle":      { "model": "deepseek/deepseek-v4-flash", "variant": "low" },
    "co-librarian":   { "model": "deepseek/deepseek-v4-flash", "variant": "low" },
    "co-explorer":    { "model": "deepseek/deepseek-v4-flash", "variant": "low" },
    "co-designer":    { "model": "minimax/MiniMax-M3", "variant": "medium" },
    "co-fixer":       { "model": "deepseek/deepseek-v4-flash", "variant": "high" },
    "co-observer":    { "model": "codermxtest/gpt-5.5", "variant": "low" },
    "co-council":     { "model": "deepseek/deepseek-v4-flash", "variant": "low" },
    "co-rule-user":   { "model": "deepseek/deepseek-v4-flash", "variant": "medium" },
    "co-rule-project":{ "model": "deepseek/deepseek-v4-flash", "variant": "medium" },
    "co-rule-app":    { "model": "deepseek/deepseek-v4-flash", "variant": "medium" },
    "co-planner":     { "model": "deepseek/deepseek-v4-flash", "variant": "low" }
  }
}
```

直接编辑此文件即可修改任意代理的模型和变体。`$schema` 提供 IDE 自动补全支持。

> **注意**：同一目录 `~/.config/opencode/oh-my-opencode-cohub/` 下也可放置 `{agent}.md` 提示词覆盖文件（见「自定义提示词」章节），与 JSON 配置文件共存。

### Council 多模型共识配置

`co-council` 代理通过 `council_session` 工具并行调用多个模型（councillors），综合各方观点形成共识。councillors 的数量、模型、推理强度完全可配置：

```json
{
  "council": {
    "default_preset": "default",
    "timeout": 180000,
    "councillor_execution_mode": "parallel",
    "councillor_retries": 3,
    "presets": {
      "default": {
        "alpha": { "model": "deepseek/deepseek-v4-pro", "variant": "max" },
        "beta":  { "model": "deepseek/deepseek-v4-flash", "variant": "high" },
        "gamma": { "model": "minimax/MiniMax-M3", "variant": "medium" }
      },
      "quick": {
        "alpha": { "model": "deepseek/deepseek-v4-flash", "variant": "high" },
        "beta":  { "model": "deepseek/deepseek-v4-flash", "variant": "low" }
      },
      "deep": {
        "alpha": { "model": "deepseek/deepseek-v4-pro", "variant": "max" },
        "beta":  { "model": "deepseek/deepseek-v4-pro", "variant": "max" },
        "gamma": { "model": "minimax/MiniMax-M3", "variant": "medium" },
        "delta": { "model": "codermxtest/gpt-5.5", "variant": "high" }
      }
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `presets` | object | (必填) | 预设字典，每个预设是一组 councillor |
| `default_preset` | string | `"default"` | 调用时不指定 preset 时使用的预设 |
| `timeout` | number | `180000` | 单个 councillor 超时（毫秒），默认 3 分钟 |
| `councillor_execution_mode` | `"parallel"` \| `"serial"` | `"parallel"` | 并行/串行执行 |
| `councillor_retries` | number | `3` | 空响应重试次数 |

- 每个 councillor 的 key（如 `alpha`、`beta`）可任意命名，会出现在输出中
- `model` 格式为 `"provider/model"`，`variant` 可选 `"max"` / `"high"` / `"medium"` / `"low"`
- councillor 数量无上限，但建议 2-5 个以平衡成本和质量
- 调用时可通过 `council_session` 工具的 `preset` 参数切换预设，如 `"quick"` 或 `"deep"`

## 工作流

CoHub 采用 Wave 波次分组并行模式，由编排引擎代码级保障执行可靠性：

```
1. 理解需求（co-orchestrator 分析用户意图）
2. 信息收集（Wave 1 — 全并行：@co-explorer + @co-librarian + @co-observer）
3. 规范分析（Wave 1 — 全并行：@co-rule-user + @co-rule-project + @co-rule-app）
4. 制定方案 → @co-planner（按依赖分 Wave 1/2/3... 输出结构化任务分解）
5. 调度执行（Wave 2+ — 同一 Wave 内全并行启动）
   - 修改 Wave：fixer/designer 仅修改文件，不编译/测试
   - 验证 Wave：所有修改完成后统一编译 + 测试
6. 验证（@co-oracle 代码审查 + @co-designer 视觉审查）
```

编排引擎在此流程中负责：

- 任务注册与 DAG 依赖自动检查，`pending→ready` 自动转换
- 并发调度不超过 `maxConcurrency`
- 失败自动重试（按代理策略），超限中止
- 级联取消：父任务取消时，未完成后继任务标记 cancelled

## 依赖

- [OpenCode](https://opencode.ai) ≥ 1.17
- 运行时依赖：
  - `@opencode-ai/plugin@^1.17.0`
  - `@opencode-ai/sdk@^1.3.17`
- TUI 面板（可选）：
  - `@opentui/solid@^0.4.3`
  - `@opentui/core@^0.4.3`
- 开发依赖（仅源码开发时需要）：
  - `typescript@^5.4.0`
  - `@types/node@^26.1.1`
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

## 版本历史

完整变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| [v1.15.0](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.15.0) | 2026-09-03 | 子代理并行工具调用：fixer/designer 同消息并行读文件、librarian 并行外部搜索、explorer 并行读取 |
| [v1.14.1](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.14.1) | 2026-09-03 | Dependabot 安全修复（3 high + 1 moderate 传递依赖升级） |
| [v1.14.0](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.14.0) | 2026-09-03 | 修改 Wave vs 验证 Wave 区分：并行改文件不再各自编译，统一编译一次 |
| [v1.13.2](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.13.2) | 2026-09-03 | 注入膨胀根治：prompt 预算兜底、CONTRACT 去重、错误截断、Job Board 折叠 |
| [v1.13.1](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.13.1) | 2026-09-03 | Wave 波次分组并行：planner/orchestrator/oracle 提示词重构 |
| [v1.13.0](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.13.0) | 2026-09-03 | 编排引擎（状态机/重试/契约/调度器）、close_job 工具、并发上限 20 |
| [v1.12.13](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.12.13) | 2026-08-07 | 修复 messages.transform 仅对最后一条 user 消息做占位修复，恢复含 file-only 历史消息的旧会话时触发 API 空 content 错误 |
| [v1.12.12](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.12.12) | 2026-08-04 | 子代理模型降级 Flash（适配 DeepSeek-V4-Flash 2026-07-31 增强），仅 orchestrator 保留 Pro；Board 会话复用修复 |
| [1.12.10-beta.1](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.12.10-beta.1) | 2026-07-30 | 调度策略优化、四阶段并行决策框架 |
| [1.12.9](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.12.9) | 2026-07-29 | 安装架构修复、配置双保险回退、prerelease 发布 |
| [1.12.0](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.12.0) | 2026-07-28 | AI 配置文案、智能模型匹配、配置外化管理 |
| [1.11.1](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.11.1) | 2026-07-28 | 配置分离（model/variant 由 hub config 唯一管理） |
| [1.10.2](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.10.2) | 2026-07-25 | 诊断日志工具 `src/utils/log.ts`、异常信息前缀统一 |
| [1.9.3](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.9.3) | 2026-07-25 | 移除 co-guardian 代理、回归精简架构 |
| [1.8.0](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.8.0) | 2026-07-24 | ContextGuard 上下文卫士、PlanGate 拆除 |
| [1.0.18](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.0.18) | 2026-07-15 | `council_session` 多模型并行共识工具 |
| [1.0.13](https://github.com/Mr-cjf/oh-my-opencode-cohub/releases/tag/v1.0.13) | 初始发布 | 12 个 co-* 代理 + 纯调度模式 |

## 许可证

MIT
