# 子代理上下文共享系统 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 oh-my-opencode-cohub 实现框架级子代理上下文共享，子代理启动时自动获取结构化上下文（相关文件、决策记录、前置依赖结果）。

**Architecture:** 新增 `src/context/` 模块（types, strategy, extractor, formatter, engine），修改现有 hook（`tool.execute.before`, `messages.transform`, `event`, `tool.execute.after`）集成上下文构建/注入/捕获三阶段流程。通过 `<!-- CONTEXT:ID=uuid -->` 标记在 description 中传递 contextId，在 `messages.transform` 中匹配替换。

**Tech Stack:** TypeScript ESM, `@opencode-ai/plugin` SDK, `@opencode-ai/sdk` v2

## Global Constraints

- 构建命令 `npm run build`（bun build + tsc），不新增外部依赖
- 所有 `@opencode-ai/*`、`zod` 为 external
- 遵循项目现有模式：工具函数放独立文件、核心类放 `src/context/engine.ts`
- 错误处理使用 try/catch 静默降级，不影响现有功能

---

## 文件结构

```
src/
├── context/
│   ├── types.ts          [新增] ContextStrategy, TaskContext, RelevantFile, DependencyResult, ContextConfig
│   ├── strategy.ts       [新增] resolveStrategy()
│   ├── extractor.ts      [新增] extractRelevantFiles(), extractDecisions(), extractErrors()
│   ├── formatter.ts      [新增] formatTaskContext()
│   └── engine.ts         [新增] ContextEngine 类
├── task-manager/
│   └── types.ts          [修改] JobRecord 新增 contextStrategy, dependencies
├── config/
│   └── loader.ts         [修改] CoHubConfig 新增 context, 导出 DEFAULT_CONTEXT_CONFIG
└── index.ts              [修改] 4 个 hook 集成
```

---

### Task 1: 创建类型定义 `src/context/types.ts`

**Files:**
- Create: `src/context/types.ts`

**Interfaces:**
- Produces: `ContextStrategy`, `RelevantFile`, `DependencyResult`, `TaskContext`, `ContextConfig`, `DEFAULT_CONTEXT_CONFIG`

- [ ] **Step 1: 写入类型文件**

```typescript
// src/context/types.ts — 上下文共享系统所有类型定义

/** 上下文注入策略 */
export type ContextStrategy = 'none' | 'relevant' | 'summary' | 'full';

/** 任务相关文件描述 */
export interface RelevantFile {
  path: string;
  lines?: string;       // 如 "42-87"
  summary: string;       // 一句话说明该文件与任务的关系
}

/** 前置子代理的完成结果 */
export interface DependencyResult {
  alias: string;         // 如 "exp-1"
  agent: string;         // 如 "co-explorer"
  keyOutput: string;     // 子代理结果中的关键信息
  capturedAt: number;    // Date.now()
}

/** 注入到子代理的结构化上下文 */
export interface TaskContext {
  goal: string;                        // 任务目标
  relevantFiles: RelevantFile[];       // 相关文件列表
  decisions: string[];                 // 父 session 中做出的关键决策
  errors: string[];                    // 需要修复的错误信息
  dependencies: DependencyResult[];    // 前置子代理的完成结果
}

/** 上下文系统配置 */
export interface ContextConfig {
  /** 各代理的默认上下文策略 */
  strategy: Record<string, ContextStrategy>;
  /** 最多注入多少个相关文件 */
  maxFiles: number;
  /** 最多注入多少条决策 */
  maxDecisions: number;
  /** 最多注入多少条错误 */
  maxErrors: number;
  /** 最多注入多少条依赖结果 */
  maxDependencies: number;
  /** 是否启用依赖传播（子代理结果自动注入到后续子代理） */
  dependencyPropagation: boolean;
  /** LLM 摘要最大 token 数 */
  summarizeMaxTokens: number;
  /** 从父 session 中扫描最近多少条消息 */
  relevantMessageWindow: number;
}

/** 默认配置 */
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  strategy: {
    'co-explorer': 'none',
    'co-librarian': 'none',
    'co-observer': 'none',
    'co-fixer': 'relevant',
    'co-designer': 'relevant',
    'co-planner': 'relevant',
    'co-oracle': 'summary',
    'co-council': 'summary',
    'co-rule-user': 'none',
    'co-rule-project': 'none',
    'co-rule-app': 'none',
  },
  maxFiles: 5,
  maxDecisions: 10,
  maxErrors: 5,
  maxDependencies: 8,
  dependencyPropagation: true,
  summarizeMaxTokens: 2000,
  relevantMessageWindow: 20,
};
```

- [ ] **Step 2: 验证构建**

```bash
npm run build
```

Expected: 构建成功（类型文件不会导致运行时错误，只需 tsc 通过）

- [ ] **Step 3: 提交**

```bash
git add src/context/types.ts
git commit -m "feat: 添加上下文共享系统类型定义"
```

---

### Task 2: 扩展配置加载 `src/config/loader.ts`

**Files:**
- Modify: `src/config/loader.ts`

**Interfaces:**
- Consumes: `ContextConfig` from `src/context/types.ts`
- Produces: `CoHubConfig.context`, `DEFAULT_CONTEXT_CONFIG` re-export

- [ ] **Step 1: 修改 CoHubConfig 接口，添加 context 字段**

在 `src/config/loader.ts` 顶部添加 import：

```typescript
import type { ContextConfig } from '../context/types';
import { DEFAULT_CONTEXT_CONFIG } from '../context/types';
```

在 `CoHubConfig` 接口中添加 `context` 字段（第 31-34 行之间）：

```typescript
export interface CoHubConfig {
  agents?: Record<string, AgentOverride>;
  council?: CouncilConfig;
  context?: Partial<ContextConfig>;  // 用户可覆盖部分字段
}
```

在文件末尾添加重新导出：

```typescript
export { DEFAULT_CONTEXT_CONFIG };
```

- [ ] **Step 2: 验证构建**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add src/config/loader.ts
git commit -m "feat: CoHubConfig 新增 context 配置字段"
```

---

### Task 3: 创建策略解析 `src/context/strategy.ts`

**Files:**
- Create: `src/context/strategy.ts`

**Interfaces:**
- Consumes: `ContextStrategy` from `./types`
- Produces: `resolveStrategy(agentType, defaults, override?) => ContextStrategy`

- [ ] **Step 1: 写入策略文件**

```typescript
// src/context/strategy.ts — 上下文策略解析

import type { ContextStrategy } from './types';

/**
 * 解析子代理的上下文策略。
 * 优先级：task 覆盖参数 > 代理默认配置 > 'none'
 */
export function resolveStrategy(
  agentType: string,
  defaults: Record<string, ContextStrategy>,
  override?: ContextStrategy,
): ContextStrategy {
  if (override) return override;
  return defaults[agentType] ?? 'none';
}
```

- [ ] **Step 2: 验证构建**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add src/context/strategy.ts
git commit -m "feat: 添加上下文策略解析模块"
```

---

### Task 4: 创建消息提取器 `src/context/extractor.ts`

**Files:**
- Create: `src/context/extractor.ts`

**Interfaces:**
- Consumes: `RelevantFile` from `./types`
- Produces: `extractRelevantFiles(messages, maxFiles, window)`, `extractDecisions(messages, max, window)`, `extractErrors(messages, max, window)`

- [ ] **Step 1: 写入提取器文件**

```typescript
// src/context/extractor.ts — 从父 session 消息中提取结构化信息

import type { RelevantFile } from './types';

/** SDK v2 消息格式（简化） */
interface SdkMessage {
  info?: { role?: string };
  parts?: Array<{ type?: string; text?: string; tool?: string; args?: unknown; tool_result?: unknown }>;
}

/**
 * 从消息列表中提取相关文件。
 * 扫描 Read/Edit/Write/Glob/Grep 工具调用和 tool_result 中的路径。
 */
export function extractRelevantFiles(
  messages: SdkMessage[],
  maxFiles: number,
  windowSize: number,
): RelevantFile[] {
  const recent = messages.slice(-windowSize);
  const fileMap = new Map<string, RelevantFile>();

  for (const msg of recent) {
    for (const part of msg.parts ?? []) {
      // 从工具调用中提取路径
      if (part.type === 'tool_call' && part.args) {
        const args = part.args as Record<string, unknown>;
        const path = extractPath(args);
        if (path && !fileMap.has(path)) {
          fileMap.set(path, { path, summary: '' });
        }
      }
      // 从工具结果中提取路径和内容摘要
      if (part.type === 'tool_result' && part.tool_result) {
        const tr = part.tool_result as Record<string, unknown>;
        const path = extractPath(tr);
        if (path && fileMap.has(path)) {
          const existing = fileMap.get(path)!;
          // 尝试提取行号范围
          const args = tr.args as Record<string, unknown> | undefined;
          if (args) {
            if (typeof args.offset === 'number') {
              const limit = typeof args.limit === 'number' ? args.limit : 50;
              existing.lines = `${args.offset}-${args.offset + limit}`;
            }
            if (typeof args.oldString === 'string') {
              existing.summary = `编辑位置: ${args.oldString.slice(0, 80)}`;
            }
          }
          if (!existing.summary && typeof tr.output === 'string') {
            existing.summary = tr.output.slice(0, 100).replace(/\n/g, ' ');
          }
        }
      }
    }
  }

  return Array.from(fileMap.values()).slice(0, maxFiles);
}

function extractPath(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.filePath === 'string') return obj.filePath;
  if (typeof obj.path === 'string') return obj.path;
  if (typeof obj.file === 'string') return obj.file;
  if (typeof obj.filepath === 'string') return obj.filepath;
  return undefined;
}

/**
 * 从 assistant 消息中提取关键决策。
 * 匹配包含决策关键词的句子。
 */
export function extractDecisions(
  messages: SdkMessage[],
  maxDecisions: number,
  windowSize: number,
): string[] {
  const recent = messages.slice(-windowSize);
  const decisions: string[] = [];
  const keywords = /(认定|决定|确认|方案是|结论|应该|不建议|必须|禁止|采用)/;

  for (const msg of recent) {
    if (msg.info?.role !== 'assistant') continue;
    for (const part of msg.parts ?? []) {
      if (part.type !== 'text' || !part.text) continue;
      const sentences = part.text.split(/[。！？\n]/);
      for (const s of sentences) {
        const trimmed = s.trim();
        if (trimmed.length > 10 && trimmed.length < 200 && keywords.test(trimmed)) {
          decisions.push(trimmed);
          if (decisions.length >= maxDecisions) return decisions;
        }
      }
    }
  }

  return decisions;
}

/**
 * 从 bash 输出中提取编译/测试错误。
 */
export function extractErrors(
  messages: SdkMessage[],
  maxErrors: number,
  windowSize: number,
): string[] {
  const recent = messages.slice(-windowSize);
  const errors: string[] = [];
  const errorPatterns = /(error|Error|TypeError|ReferenceError|SyntaxError|RangeError|FAIL|failed|cannot find|cannot resolve|not found|unexpected token)/;

  for (const msg of recent) {
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool_result' || !part.tool_result) continue;
      const tr = part.tool_result as Record<string, unknown>;
      const output = typeof tr.output === 'string' ? tr.output : '';
      if (!output) continue;
      const lines = output.split('\n');
      for (const line of lines) {
        if (errorPatterns.test(line) && line.length < 300) {
          errors.push(line.trim());
          if (errors.length >= maxErrors) return errors;
        }
      }
    }
  }

  return errors;
}
```

- [ ] **Step 2: 验证构建**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add src/context/extractor.ts
git commit -m "feat: 添加上下文消息提取器"
```

---

### Task 5: 创建格式化器 `src/context/formatter.ts`

**Files:**
- Create: `src/context/formatter.ts`

**Interfaces:**
- Consumes: `TaskContext` from `./types`
- Produces: `formatTaskContext(ctx) => string`, `CONTEXT_MARKER_PATTERN`

- [ ] **Step 1: 写入格式化器文件**

```typescript
// src/context/formatter.ts — 将 TaskContext 格式化为注入用的 Markdown

import type { TaskContext } from './types';

/** 上下文标记正则 — 用于在 messages.transform 中匹配 */
export const CONTEXT_MARKER_PATTERN = /<!-- CONTEXT:ID=([a-f0-9-]+) -->/;

/** 生成上下文标记文本 */
export function formatContextMarker(contextId: string): string {
  return `\n\n<!-- CONTEXT:ID=${contextId} -->`;
}

/**
 * 将 TaskContext 格式化为注入到子代理 user 消息中的 Markdown 块。
 */
export function formatTaskContext(context: TaskContext): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('### 📋 任务上下文 (CoHub 自动注入)');
  lines.push('');

  if (context.goal) {
    lines.push(`**当前任务**: ${context.goal}`);
    lines.push('');
  }

  if (context.relevantFiles.length > 0) {
    lines.push('**相关文件**:');
    lines.push('| 文件 | 说明 |');
    lines.push('|------|------|');
    for (const f of context.relevantFiles) {
      const loc = f.lines ? `:${f.lines}` : '';
      lines.push(`| \`${f.path}${loc}\` | ${f.summary || '-'} |`);
    }
    lines.push('');
  }

  if (context.decisions.length > 0) {
    lines.push('**前置决策**:');
    for (let i = 0; i < context.decisions.length; i++) {
      lines.push(`${i + 1}. ${context.decisions[i]}`);
    }
    lines.push('');
  }

  if (context.dependencies.length > 0) {
    lines.push('**依赖结果**:');
    for (const d of context.dependencies) {
      lines.push(`- \`${d.alias}\` (${d.agent}): ${d.keyOutput}`);
    }
    lines.push('');
  }

  if (context.errors.length > 0) {
    lines.push('**错误信息**:');
    for (const e of context.errors) {
      lines.push(`- \`${e}\``);
    }
    lines.push('');
  }

  lines.push('<!-- CONTEXT:END -->');
  return lines.join('\n');
}

/**
 * 将标记替换为格式化的上下文块。
 * 返回替换后的完整消息文本，或 null（如果未找到标记）。
 */
export function replaceMarkerWithContext(messageText: string, context: TaskContext): string | null {
  const match = messageText.match(CONTEXT_MARKER_PATTERN);
  if (!match) return null;

  const formatted = formatTaskContext(context);
  return messageText.replace(CONTEXT_MARKER_PATTERN, formatted);
}
```

- [ ] **Step 2: 验证构建**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add src/context/formatter.ts
git commit -m "feat: 添加上下文格式化器"
```

---

### Task 6: 创建 ContextEngine `src/context/engine.ts`

**Files:**
- Create: `src/context/engine.ts`

**Interfaces:**
- Consumes: All types from `./types`, extractors from `./extractor`, formatter from `./formatter`, SDK client
- Produces: `ContextEngine` class

- [ ] **Step 1: 写入引擎文件**

```typescript
// src/context/engine.ts — 上下文引擎核心

import type { ContextStrategy, TaskContext, ContextConfig, DependencyResult } from './types';
import { DEFAULT_CONTEXT_CONFIG } from './types';
import { extractRelevantFiles, extractDecisions, extractErrors } from './extractor';
import { formatContextMarker, replaceMarkerWithContext } from './formatter';
import type { createOpencodeClient } from '@opencode-ai/sdk';

type SdkClient = ReturnType<typeof createOpencodeClient>;

export class ContextEngine {
  /** contextId → TaskContext */
  private registry = new Map<string, TaskContext>();
  /** alias → 前置子代理结果 */
  private dependencyCache = new Map<string, DependencyResult>();
  private client: SdkClient;
  private config: ContextConfig;

  constructor(client: SdkClient, config?: Partial<ContextConfig>) {
    this.client = client;
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
  }

  /**
   * Phase A: 构建上下文。
   * 从父 session 提取信息 → 构造 TaskContext → 存入 registry → 返回 contextId。
   */
  async constructContext(
    parentSessionId: string,
    args: {
      description: string;
      subagent_type: string;
      strategy: ContextStrategy;
    },
  ): Promise<string> {
    const contextId = crypto.randomUUID();
    const context: TaskContext = {
      goal: args.description,
      relevantFiles: [],
      decisions: [],
      errors: [],
      dependencies: [],
    };

    if (args.strategy === 'none') {
      this.registry.set(contextId, context);
      return contextId;
    }

    try {
      const windowSize = this.config.relevantMessageWindow;
      const messagesResult = await this.client.session.messages({
        path: { id: parentSessionId },
        query: { limit: windowSize },
      });
      const messages = (messagesResult.data ?? []) as Array<{
        info?: { role?: string };
        parts?: Array<{ type?: string; text?: string; tool?: string; args?: unknown; tool_result?: unknown }>;
      }>;

      if (args.strategy === 'relevant' || args.strategy === 'summary' || args.strategy === 'full') {
        context.relevantFiles = extractRelevantFiles(messages, this.config.maxFiles, windowSize);
        context.decisions = extractDecisions(messages, this.config.maxDecisions, windowSize);
        context.errors = extractErrors(messages, this.config.maxErrors, windowSize);
      }

      // 注入前置依赖结果
      if (this.config.dependencyPropagation && this.dependencyCache.size > 0) {
        context.dependencies = Array.from(this.dependencyCache.values())
          .slice(-this.config.maxDependencies);
      }
    } catch {
      // SDK 调用失败时返回最小上下文
    }

    this.registry.set(contextId, context);
    return contextId;
  }

  /**
   * Phase B: 消费标记文本。
   * 从消息文本中提取 contextId → 查 registry → 替换标记为格式化上下文。
   * 返回替换后的完整文本，或 null（无标记或未找到上下文）。
   */
  consumeMarkedContext(messageText: string): string | null {
    const markerMatch = messageText.match(/<!-- CONTEXT:ID=([a-f0-9-]+) -->/);
    if (!markerMatch) return null;

    const contextId = markerMatch[1];
    const context = this.registry.get(contextId);
    if (!context) {
      // 上下文已过期或被清理，移除标记
      return messageText.replace(/<!-- CONTEXT:ID=[a-f0-9-]+ -->/, '');
    }

    const result = replaceMarkerWithContext(messageText, context);
    // 消费后清理
    this.registry.delete(contextId);
    return result;
  }

  /**
   * Phase C: 捕获子代理结果。
   * 读取子 session 的最终输出 → 提取关键信息 → 存入 dependencyCache。
   */
  async captureResult(
    childSessionId: string,
    alias: string,
    agent: string,
  ): Promise<void> {
    if (!this.config.dependencyPropagation) return;

    try {
      const messagesResult = await this.client.session.messages({
        path: { id: childSessionId },
      });
      const messages = (messagesResult.data ?? []) as Array<{
        info?: { role?: string };
        parts?: Array<{ type?: string; text?: string }>;
      }>;

      // 从最后一条 assistant 消息提取关键输出
      let keyOutput = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].info?.role === 'assistant') {
          for (const part of messages[i].parts ?? []) {
            if (part.type === 'text' && part.text) {
              keyOutput = part.text.slice(0, 500).replace(/\n/g, ' ');
              break;
            }
          }
          if (keyOutput) break;
        }
      }

      if (keyOutput) {
        this.dependencyCache.set(alias, {
          alias,
          agent,
          keyOutput,
          capturedAt: Date.now(),
        });
      }
    } catch {
      // SDK 调用失败时静默跳过
    }
  }

  /**
   * 生成上下文标记文本，追加到 task description 末尾。
   */
  formatMarker(contextId: string): string {
    return formatContextMarker(contextId);
  }

  /**
   * 清理过期的依赖缓存（超过 10 分钟的条目）。
   */
  cleanupStaleDependencies(maxAgeMs: number = 10 * 60 * 1000): void {
    const now = Date.now();
    for (const [key, value] of this.dependencyCache) {
      if (now - value.capturedAt > maxAgeMs) {
        this.dependencyCache.delete(key);
      }
    }
  }
}
```

- [ ] **Step 2: 验证构建**

```bash
npm run build
```

- [ ] **Step 3: 提交**

```bash
git add src/context/engine.ts
git commit -m "feat: 添加 ContextEngine 核心引擎"
```

---

### Task 7: 扩展 JobRecord `src/task-manager/types.ts`

**Files:**
- Modify: `src/task-manager/types.ts`

**Interfaces:**
- Consumes: `ContextStrategy` from `../context/types`
- Produces: `JobRecord` 新增 `contextStrategy`, `dependencies` 字段

- [ ] **Step 1: 添加 import 和新字段**

在文件顶部添加 import：

```typescript
import type { ContextStrategy } from '../context/types';
```

在 `JobRecord` 接口的 `createdAt` 字段后添加（第 12 行后）：

```typescript
  /** 此子代理的上下文策略 */
  contextStrategy?: ContextStrategy;
  /** 依赖的前置任务别名列表 */
  dependencies?: string[];
```

最终 `JobRecord` 应为：

```typescript
export interface JobRecord {
  alias: string;
  sessionId: string;
  parentSessionId: string;
  agent: string;
  label: string;
  status: TaskStatus;
  background: boolean;
  terminalReconciled: boolean;
  createdAt: number;
  contextStrategy?: ContextStrategy;
  dependencies?: string[];
}
```

- [ ] **Step 2: 验证构建**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add src/task-manager/types.ts
git commit -m "feat: JobRecord 新增上下文策略和依赖字段"
```

---

### Task 8: 集成 Hook `src/index.ts`

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `ContextEngine` from `./context/engine`, `resolveStrategy` from `./context/strategy`, `DEFAULT_CONTEXT_CONFIG` from `./config/loader`
- Produces: 4 个 hook 的上下文集成逻辑

**这是最关键的任务。需要精确修改 4 处。**

- [ ] **Step 1: 添加 import（在 `src/index.ts` 顶部）**

在 `import { TaskTracker }` 之后（第 16 行后）添加：

```typescript
import { ContextEngine } from './context/engine';
import { resolveStrategy } from './context/strategy';
import type { ContextStrategy } from './context/types';
```

- [ ] **Step 2: 添加 Tracker 查询方法（修改 `src/task-manager/tracker.ts`）**

在 `getRunningCount` 方法之后添加：

```typescript
  /** 根据子 session ID 查找 JobRecord */
  getJobBySessionId(sessionId: string): { alias: string; agent: string } | undefined {
    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId) {
        return { alias: job.alias, agent: job.agent };
      }
    }
    return undefined;
  }
```

- [ ] **Step 3: 初始化 ContextEngine（在 `src/index.ts` 中 `const councilManager` 之前，约第 283 行）**

```typescript
  // 初始化上下文引擎
  const contextConfig = userConfig.context ?? {};
  const contextEngine = new ContextEngine(input.client, contextConfig);
```

- [ ] **Step 4: 修改 `tool.execute.before` hook（替换第 356-369 行）**

将现有的 before hook 替换为：

```typescript
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
            const strategy = resolveStrategy(
              subagentType,
              contextConfig.strategy ?? {},
              typeof args.context_override === 'string'
                ? (args.context_override as ContextStrategy)
                : undefined,
            );
            if (strategy !== 'none') {
              contextEngine.constructContext(input.sessionID, {
                description,
                subagent_type: subagentType,
                strategy,
              }).then(contextId => {
                // 在 description 末尾追加标记
                output.args.description = description +
                  contextEngine.formatMarker(contextId);
              });
            }
          }
        }
      } catch { /* 静默失败 */ }
    },
```

- [ ] **Step 5: 修改 `experimental.chat.messages.transform` hook（替换第 401-420 行）**

将现有的 transform hook 替换为：

```typescript
    'experimental.chat.messages.transform': async (_input, output) => {
      try {
        // 新增：扫描并替换上下文标记（在所有 user 消息中）
        if (output.messages && Array.isArray(output.messages)) {
          for (const msg of output.messages) {
            if (msg.info.role !== 'user') continue;
            for (const part of msg.parts ?? []) {
              if (part.type !== 'text' || !part.text) continue;
              const replaced = contextEngine.consumeMarkedContext(part.text);
              if (replaced !== null) {
                part.text = replaced;
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
```

- [ ] **Step 6: 不修改 `tool.execute.after` hook（第 372-381 行）**

在现有 after hook 中添加上下文捕获逻辑：

```typescript
    'tool.execute.after': async (input, output) => {
      try {
        if (input.tool === 'task') {
          const childSessionId = extractChildSessionId(output);
          tracker.updateAfterTask(input.sessionID, 'completed', childSessionId);
          syncTrackerState(input.sessionID ?? '');
        }
      } catch { /* 静默失败 */ }
    },
```

（此 hook 不修改——captureResult 在 `event` hook 的 `session.idle` 中处理）

- [ ] **Step 7: 修改 `event` hook（替换第 384-398 行），添加 captureResult**

```typescript
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
            contextEngine.captureResult(sessionId, job.alias, job.agent);
          }
        } else if (e.type === 'session.deleted' || e.type === 'session.error') {
          tracker.updateByChildSessionId(sessionId, 'errored');
          syncTrackerState(tracker.currentParentSessionId);
        }
      } catch { /* 静默失败 */ }
    },
```

- [ ] **Step 8: 添加定时清理依赖缓存**

在 `setInterval` 清理过期任务之后（第 321-325 行），添加：

```typescript
  setInterval(() => {
    try {
      contextEngine.cleanupStaleDependencies();
    } catch { /* 静默 */ }
  }, 60_000);
```

- [ ] **Step 9: 验证构建**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 10: 提交**

```bash
git add src/index.ts src/task-manager/tracker.ts
git commit -m "feat: 集成上下文引擎到所有 Hook"
```

---

### Task 9: 构建验证

**Files:**
- 验证所有文件

- [ ] **Step 1: 完整构建**

```bash
npm run build
```

Expected: bun build + tsc 全部通过，dist/ 正常生成

- [ ] **Step 2: 检查 dist 输出**

```bash
dir dist\context\   # 确认 context 模块被编译
```

Expected: 看到 `types.js`, `strategy.js`, `extractor.js`, `formatter.js`, `engine.js`

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "chore: 验证构建通过"
```

---

## 任务依赖图

```
Task 1 (types) ──┬── Task 2 (config) ── Task 3 (strategy)
                 ├── Task 4 (extractor) ──────────────┐
                 ├── Task 5 (formatter) ──────────────┤
                 └── Task 7 (tracker types) ──────────┤
                                                       ├── Task 6 (engine)
                                                       │        │
                                                       └────────┤
                                                                │
                                           Task 8 (index.ts) ──┘
                                                                │
                                           Task 9 (verify) ────┘
```

并行组：
- Task 2, 4, 5, 7 可并行（均只依赖 Task 1）
- Task 3 依赖 Task 2
- Task 6 依赖 Task 3, 4, 5
- Task 8 依赖 Task 6, 7
