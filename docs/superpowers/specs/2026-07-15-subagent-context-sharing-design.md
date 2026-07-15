# 子代理上下文共享系统 — 设计规格

> 日期：2026-07-15 | 状态：设计中 | 作者：CoHub Team

## 一、目标

为 oh-my-opencode-cohub 实现框架级子代理上下文共享。子代理在启动时自动获取结构化上下文（相关文件、决策记录、前置依赖结果），避免重复探索和上下文断裂。

## 二、架构概览

```
Orchestrator (主代理)
  │
  ├─ 调用 task(co-fixer, "修复 auth.ts 类型错误")
  │     │
  │     ├─[Phase A] tool.execute.before
  │     │   ├─ 解析策略: agent默认值 vs task覆盖参数
  │     │   ├─ constructContext(): 从父session提取文件/决策/错误
  │     │   ├─ 生成 contextId (UUID) → 存入 ContextRegistry
  │     │   └─ 在 description 末尾注入标记: <!-- CONTEXT:ID=uuid -->
  │     │
  │     ├─[Phase B] messages.transform (子session上下文)
  │     │   ├─ 扫描第一条user消息，匹配标记正则
  │     │   ├─ 提取 contextId → 从 Registry 取出 TaskContext
  │     │   ├─ 移除标记，替换为格式化上下文块
  │     │   └─ 清理 Registry 条目
  │     │
  │     └─[Phase C] tool.execute.after / session.idle
  │         ├─ 获取 childSessionId
  │         ├─ 关联 contextId → sessionId (供调试)
  │         ├─ captureResult(): 读取子session最终输出
  │         └─ 存入 dependencyCache → 后续兄弟子代理自动获取
```

## 三、核心类型

### 3.1 上下文策略

```typescript
type ContextStrategy = 'none' | 'relevant' | 'summary' | 'full';
```

| 策略 | 注入内容 | Token 成本 | 默认适用 |
|------|---------|-----------|---------|
| `none` | 不注入任何上下文 | 0 | co-explorer, co-librarian, co-observer, co-rule-* |
| `relevant` | 相关文件摘要 + 决策 + 错误 + 依赖结果 | 低 | co-fixer, co-designer, co-planner |
| `summary` | LLM 压缩的对话摘要 + 以上全部 | 中 | co-oracle, co-council |
| `full` | 父 session 完整消息历史 | 高 | 复杂重构、跨文件联动 |

### 3.2 TaskContext

```typescript
interface TaskContext {
  goal: string;                        // 任务目标
  relevantFiles: RelevantFile[];       // 相关文件
  decisions: string[];                 // 关键决策
  errors: string[];                    // 错误信息
  dependencies: DependencyResult[];    // 前置依赖结果
}

interface RelevantFile {
  path: string;
  lines?: string;                      // "42-87"
  summary: string;
}

interface DependencyResult {
  alias: string;                       // "exp-1"
  agent: string;                       // "co-explorer"
  keyOutput: string;
  capturedAt: number;
}
```

### 3.3 JobRecord 扩展

在 `src/task-manager/types.ts` 的 `JobRecord` 中新增：

```typescript
contextStrategy?: ContextStrategy;
dependencies?: string[];               // 前置任务别名列表
```

## 四、核心模块

### 4.1 ContextEngine (`src/context/engine.ts`)

```typescript
class ContextEngine {
  private registry: Map<string, TaskContext>;              // contextId → context
  private idToSession: Map<string, string>;                // contextId → childSessionId
  private dependencyCache: Map<string, DependencyResult>;   // alias → result

  // Phase A：构建上下文，返回 contextId
  constructContext(
    parentSessionId: string,
    args: { description: string; subagent_type: string; strategy: ContextStrategy }
  ): string;

  // Phase B：接收含标记的完整消息文本，提取 contextId → 查 Registry →
  //         格式化为上下文块 → 替换标记 → 返回完整文本。无标记时返回 null。
  consumeMarkedContext(messageText: string): string | null;

  // Phase C：捕获子代理结果
  captureResult(
    childSessionId: string, alias: string, agent: string
  ): Promise<void>;

  // 工具方法：LLM 压缩对话历史
  summarizeHistory(sessionId: string, maxTokens: number): Promise<string>;
}
```

### 4.2 Extractor (`src/context/extractor.ts`)

从父 session 消息中提取结构化信息：

- `extractRelevantFiles(messages)` — 从工具调用中提取文件路径和摘要
- `extractDecisions(messages)` — 从 assistant 消息中匹配决策关键词
- `extractErrors(messages)` — 从 bash 输出中匹配编译/测试错误

### 4.3 Formatter (`src/context/formatter.ts`)

将 `TaskContext` 格式化为注入用的 Markdown：

```markdown
### 📋 任务上下文 (CoHub 自动注入)

**当前任务**: {goal}

**相关文件**: ...
**前置决策**: ...
**依赖结果**: ...
**错误信息**: ...
```

### 4.4 Strategy (`src/context/strategy.ts`)

```typescript
function resolveStrategy(
  agentType: string,
  override?: ContextStrategy
): ContextStrategy;

// 默认映射（可被 opencode.json 配置覆盖）:
const DEFAULT_STRATEGIES: Record<string, ContextStrategy> = {
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
};
```

## 五、Hook 改造

### 5.1 `tool.execute.before` (`src/index.ts`)

```typescript
if (input.tool === 'task') {
  // 现有：注册任务
  const alias = tracker.registerBeforeTask(input.sessionID, args);

  // 新增：构建上下文
  const strategy = resolveStrategy(
    args.subagent_type ?? 'unknown',
    args.context_override as ContextStrategy | undefined
  );
  if (strategy !== 'none') {
    const contextId = contextEngine.constructContext(input.sessionID, {
      description: args.description ?? '',
      subagent_type: args.subagent_type ?? 'unknown',
      strategy,
    });
    // 在 description 末尾追加标记
    output.args.description = (args.description ?? '') +
      `\n\n<!-- CONTEXT:ID=${contextId} -->`;
    // 记录 contextId → alias 映射
    contextRegistry.set(contextId, alias);
  }
}
```

### 5.2 `experimental.chat.messages.transform` (`src/index.ts`)

```typescript
// 现有：注入 Background Job Board
// （保持不变）

// 新增：扫描并替换上下文标记
for (const msg of output.messages) {
  if (msg.info.role !== 'user') continue;
  for (const part of msg.parts) {
    if (part.type !== 'text') continue;
    const match = part.text.match(/<!-- CONTEXT:ID=([a-f0-9-]+) -->/);
    if (match) {
      const contextId = match[1];
      const formatted = contextEngine.consumeMarkedContext(part.text);
      if (formatted) {
        part.text = formatted;
      }
      break;
    }
  }
}
```

### 5.3 `event` (session.idle) (`src/index.ts`)

```typescript
// 现有：背景任务完成处理

// 新增：捕获结果用于依赖传播
if (status.type === 'idle') {
  const job = tracker.findBySessionId(sessionId);
  if (job) {
    await contextEngine.captureResult(sessionId, job.alias, job.agent);
  }
}
```

### 5.4 `tool.execute.after` (`src/index.ts`)

```typescript
// 现有：更新任务状态

// 新增：关联 contextId → childSessionId
if (childSessionId) {
  contextEngine.linkSession(contextId, childSessionId);
}
```

## 六、配置

### 6.1 opencode.json

```json
{
  "plugin": [["oh-my-opencode-cohub", {
    "context": {
      "strategy": { "co-fixer": "relevant", "co-oracle": "summary" },
      "maxFiles": 5,
      "maxDecisions": 10,
      "maxErrors": 5,
      "maxDependencies": 8,
      "dependencyPropagation": true,
      "summarizeMaxTokens": 2000,
      "relevantMessageWindow": 20
    }
  }]]
}
```

### 6.2 运行时覆盖

Orchestrator 在 `task` 调用中通过 `context_override` 参数覆盖默认策略：

```
task(subagent_type="co-fixer", description="...", context_override="full")
```

## 七、注入内容格式

子代理收到的第一条 user 消息将包含以下结构（替换标记后）：

```markdown
修复 auth.ts 中的类型错误，将 User.email 改为 non-nullable

### 📋 任务上下文 (CoHub 自动注入)

**当前任务**: 修复 src/auth/auth.ts:56 的类型错误

**相关文件**:
| 文件 | 说明 |
|------|------|
| `src/auth/auth.ts:42-87` | User 类型定义，第56行有类型不匹配 |
| `src/auth/middleware.ts:15-30` | 使用 User 类型的中间件，可能受影响 |

**前置决策**:
1. User.email 从 string|null 改为 string
2. 修改范围限定 src/auth/

**依赖结果**:
- `exp-2` (co-explorer): User 类型被12个文件引用，均来自 src/auth/middleware.ts 的 import 链

**错误信息**:
- `src/auth/auth.ts:56` Type 'string | null' not assignable to 'string'
```

## 八、文件变更清单

| 文件 | 操作 | 内容 |
|------|------|------|
| `src/context/types.ts` | **新增** | ContextStrategy, TaskContext, RelevantFile, DependencyResult |
| `src/context/engine.ts` | **新增** | ContextEngine 核心类 |
| `src/context/strategy.ts` | **新增** | resolveStrategy + 默认映射 |
| `src/context/extractor.ts` | **新增** | extractRelevantFiles, extractDecisions, extractErrors |
| `src/context/formatter.ts` | **新增** | formatTaskContext → Markdown |
| `src/task-manager/types.ts` | **修改** | JobRecord 新增 contextStrategy, dependencies |
| `src/index.ts` | **修改** | 4 个 hook 集成 |
| `src/config/loader.ts` | **修改** | 加载 context 配置块 |

## 九、实施顺序

| 阶段 | 文件 | 依赖 |
|------|------|------|
| P1 | `context/types.ts` | 无 |
| P2 | `config/loader.ts`（修改） | P1 |
| P3 | `context/strategy.ts` | P1, P2 |
| P4 | `context/extractor.ts` | P1 |
| P5 | `context/formatter.ts` | P1 |
| P6 | `context/engine.ts` | P1-P5 |
| P7 | `task-manager/types.ts`（修改） | P1 |
| P8 | `index.ts`（修改） | P6, P7 |
| P9 | 构建验证 | P8 |

P1-P5 可并行；P6 串行依赖 P1-P5；P7-P8 依赖 P6 但 P7 可与 P3-P5 并行。

## 十、边界情况与降级

| 场景 | 处理 |
|------|------|
| `messages.transform` 中找不到标记 | 正常返回，不注入（可能是 Orchestrator 自身或旧 task 调用） |
| contextRegistry 中 contextId 已过期 | 标记被静默移除，不注入上下文 |
| extractor 从父 session 提取失败 | 返回仅含 goal 的最小 TaskContext |
| 并行多子代理标记相同前缀 | UUID 保证唯一性，无冲突 |
| 父 session 消息过多 | `relevantMessageWindow` 限制扫描范围（默认最近 20 条） |
| 子代理是背景任务 | 同样触发 Phase A/B/C，不区分前台/后台 |
| SDK 中 `session.messages()` 对子 session 不可用 | `captureResult` 降级为空操作，不影响主流程 |
| ContextEngine 需要 SDK client 访问 `session.messages()` | 通过插件工厂函数的 `{ client }` 注入到 Engine 构造函数 |
| `messages.transform` 中上下文注入和 Job Board 注入的顺序 | 上下文注入（替换标记）先执行，Job Board（追加末尾）后执行，两者可能命中同一 user 消息 |


## 十一、核对清单

- [ ] 所有新增类型有完整的 TypeScript 定义
- [ ] ContextEngine 的 constructContext / consumeMarkedContext / captureResult 接口清晰
- [ ] Hook 改造对现有功能（Job Board、中文注入）无副作用
- [ ] 默认策略映射覆盖全部 12 个代理
- [ ] 配置加载有回退默认值
- [ ] 标记格式不会被 LLM 误解释
- [ ] 上下文注入块有明确的开始/结束边界
- [ ] `npm run build` 通过
