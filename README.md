# oh-my-opencode-cohub

OpenCode 中文智能体编排插件 CoHub——纯调度模式、全中文提示词、规范分析代理、方案制定代理。

## 特性

- 🚀 **独立运行**：纯 OpenCode Plugin，依赖 `@opencode-ai/plugin` SDK，零外部插件依赖
- 🤖 **12 个内置代理**：8 个通用代理（orchestrator/oracle/librarian/explorer/designer/fixer/observer/council）+ 4 个规范/方案代理（rule-user/rule-project/rule-app/planner）
- 🪝 **自动注入**：通过 `system.transform` 钩子在每次 LLM 调用时注入中文语言要求
- 🧠 **纯调度 Orchestrator**：不碰任何文件工具，只负责规划、委派、验证
- 🇨🇳 **全中文提示词**：8 个内置代理 + 4 个插件代理全中文
- 📋 **规范分析代理**：rule-user（用户AGENTS.md）、rule-project（项目AGENTS.md）、rule-app（.opencode/rules/）
- 🎯 **方案制定代理**：planner 综合所有输入输出结构化任务分解
- 🔗 **OpenSpec + Superpowers 死板路由**：收到需求即触发，不判断"大小"
- ⚡ **六步工作流**：理解→收集→规范分析→制定方案→调度→验证
- 📜 **AGENTS.md 全覆盖**：项目级和用户级 AGENTS.md 对**本插件所有代理**（内置 8 个 + 插件 4 个）均生效，无需额外配置
- 📖 **架构借鉴**：插件架构和代理编排理念借鉴了 oh-my-opencode-slim，但完全独立实现、无运行时依赖

## 快速开始

### 安装

```bash
npm install oh-my-opencode-cohub
```

### 配置 opencode.json

```json
{
  "plugin": ["oh-my-opencode-cohub"]
}
```

重启 OpenCode 即可。12 个代理自动注册，中文语言要求自动注入。

### 使用方式

安装后，OpenCode 会自动：
- 加载中文代理提示词
- 注册 4 个插件代理：@rule-user、@rule-project、@rule-app、@planner
- 注入中文语言要求
- 所有代理（包括 @rule-user、@rule-project、@rule-app、@planner）自动继承项目级和用户级 AGENTS.md 规则

## 代理一览

### 代理（12 个，全中文提示词）

| 代理 | 模型 | 职责 | 读取源 |
|------|------|------|--------|
| orchestrator | 见默认配置 | 纯调度：规划→委派→验证 | — |
| oracle | 见默认配置 | 架构审查/代码审查（含 Superpowers skills） | — |
| librarian | 见默认配置 | 外部文档/API 研究 | — |
| explorer | 见默认配置 | 代码库搜索定位 | — |
| designer | 见默认配置 | UI/UX 设计与实现 | — |
| fixer | 见默认配置 | 代码修改执行（含 TDD skill） | — |
| observer | 见默认配置 | 图片/PDF 分析 | — |
| council | 见默认配置 | 多模型共识 | — |
| rule-user | 见默认配置 | 用户级规范分析 | `~/.config/opencode/AGENTS.md` |
| rule-project | 见默认配置 | 项目级规范分析 | 项目 `AGENTS.md` |
| rule-app | 见默认配置 | 应用规则分析 | `.opencode/rules/*.md` |
| planner | 见默认配置 | 方案制定 | 综合需求+信息+规则 |

> 模型通过 `DEFAULT_MODELS` 常量配置，默认使用 DeepSeek，可通过 plugin config 覆盖任意代理模型。

## 工作流

```
1. 理解需求
2. 信息收集（@explorer / @librarian / @observer）
3. 规范分析（并行 @rule-user / @rule-project / @rule-app）
4. 制定方案 → @planner
5. 调度执行（@fixer / @designer 等）
6. 验证（@oracle / @designer）
```

## 依赖

- OpenCode
- `@opencode-ai/plugin`（TypeScript 编译依赖）
- 无其他外部插件依赖

## 自定义模型

通过 `opencode.json` 的 plugin config 覆盖默认模型：

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
