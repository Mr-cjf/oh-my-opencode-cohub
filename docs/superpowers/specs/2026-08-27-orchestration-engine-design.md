# Orchestration Engine — 编排可靠性增强设计

> 让 orchestrator 的编排变得更加可靠，通过代码保证而非 LLM 记忆。
> 对应 A（状态机）+ B（错误恢复）+ C（上下文契约）三个维度。

## 问题

当前 orchestrator 的可靠性短板：

| 问题 | 表现 | 根因 |
|------|------|------|
| 无状态机 | 任务依赖靠 orchestrator 记忆，长会话偏离 | `JobRecord.dependencies` 是死字段 |
| 无重试 | 子代理失败即结束，不自动恢复 | 只有 council 内部有重试，orchestrator 层零重试 |
| 上下文靠猜测 | 决策提取靠中文关键词，结构化程度低 | extractor 用正则，非标记块 |
| 无进度持久化 | 方案只在会话中，跨会话丢失 | 无 todowrite 同步，无持久化方案 |

## 方案：三个新模块，不破坏现有代码

```
src/orchestration/
├── types.ts          # 编排专用类型
├── engine.ts         # 状态机引擎（DAG 依赖图 + 状态转换 + 级联取消）
├── retry.ts          # 重试管理器（指数退避 + 降级路由 + 预算）
├── contract.ts       # 上下文契约（结构化 handoff）
├── scheduler.ts      # 调度器（就绪任务队列 + 并发控制）
└── index.ts          # 统一导出 + 集成入口
```

不修改：`TaskTracker`、`context/`、`tools/`、`prompts/`。

## 状态机设计

### 六状态

```
pending ──→ ready ──→ running ──→ completed
             │                    │
             │                    └── failed ──→ pending (重试)
             │                                 └── cancelled (放弃)
             └────────── cancelled
```

### 合法转换表

| 当前状态 | 可转换到 | 触发条件 |
|---------|---------|---------|
| `pending` | `ready`, `cancelled` | 依赖就绪 / 级联取消 |
| `ready` | `running`, `cancelled` | 调度器派遣 / 级联取消 |
| `running` | `completed`, `failed`, `cancelled` | 成功 / 失败 / 用户取消 |
| `failed` | `pending`, `cancelled` | 重试 / 放弃 |
| `completed` | — | 终态 |
| `cancelled` | — | 终态 |

### 级联取消

任务 A 被取消 → 遍历 A 的 `dependents` → 所有后继任务自动 `cancelled`。

### 与 TaskTracker 的关系

`OrchestrationEngine` 是 `TaskTracker` 的上层编排层，组合而非继承。状态变更时双向同步：
- `engine.transition(alias, 'running')` → `tracker.registerBeforeTask(…)`
- `engine.transition(alias, 'completed')` → `tracker.updateAfterTask(…)`
- engine 状态变更 → `syncTodo()` 更新 todowrite

## 重试管理器

### 设计原则

复用 council 已验证的模式，抽出为通用层：

| council 内部 | 通用层 (retry.ts) |
|-------------|------------------|
| T2 决策表 | `RetryPolicy.decide()` |
| T4 共享预算 | `RetryBudget` 通用类 |
| T7 前馈降级 | `AgentFallback` 按 agent 配置 |
| T8 参数自适应 | `AdaptiveParams` 通用类 |

### 按 agent 类型配置策略

```typescript
const DEFAULT_RETRY_POLICIES = {
  'co-explorer': { maxRetries: 2, backoff: 'exponential', backoffMs: 2000,
    retryableErrors: ['rate limit', 'timeout', 'too many requests'],
    nonRetryableErrors: ['not found', 'permission'] },
  'co-fixer':     { maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
    retryableErrors: ['timeout', 'build failed', 'test failed'],
    nonRetryableErrors: ['syntax error', 'invalid'] },
  'co-council':   { maxRetries: 2, backoff: 'exponential', backoffMs: 2000,
    retryableErrors: ['timeout', 'rate limit'],
    nonRetryableErrors: ['invalid api key'] },
};
```

### 降级路由

| 原始代理 | 失败模式 | 降级到 |
|---------|---------|--------|
| `co-fixer` | 连续 3 次构建失败 | `co-oracle` 先审查 |
| `co-council` | 全部模型超时 | `co-oracle` 单模型 |
| `co-designer` | 连续失败 | `co-fixer` 直接改代码 |

## 上下文契约

### 问题：当前 extractor 靠正则猜测

父 agent 说"我决定用 Express" → extractor 匹配到"决定"关键词 → 提取文本片段 → 子 agent 靠 LLM 理解 → 不可靠。

### 方案：结构化 handoff 标记块

子代理输出末尾插入标准标记块：

```markdown
<!-- CONTRACT_BEGIN -->
- 关键结果: AuthService 重构完成
- 决策: Express → Fastify 迁移
- 修改文件: src/services/auth.ts
- 验证状态: 136/136 passed
- 待完成: 性能基准测试
- 警告: 无
<!-- CONTRACT_END -->
```

```typescript
interface AgentContract {
  keyResult: string;
  decisions: string[];
  filesChanged: string[];
  validationStatus: 'passed' | 'failed' | 'unknown';
  validationDetail?: string;
  pendingItems: string[];
  warnings: string[];
}
```

### 与现有 extractor 的关系

**契约优先，extractor fallback**：能提取到 `<!-- CONTRACT_BEGIN -->` 块就用结构化数据，提取不到时 fallback 到现有 extractor 的正则猜测。不强制现有提示词改，逐步迁移。

## 调度器

### 并发控制

```typescript
class Scheduler {
  private maxConcurrency: number;

  dispatch(runningCount: number): string[] {
    const ready = engine.getReadyTasks();
    const available = this.maxConcurrency - runningCount;
    return ready.slice(0, Math.max(0, available));
  }
}
```

全局限制，不按 agent 类型细分。orchestrator 通过"不同文件并行、同文件串行"规则自行控制写冲突。

## 完整数据流

```
[orchestrator 收到需求]
  → engine.registerTask('exp-1', deps=[])     // pending→ready
  → engine.registerTask('fix-1', deps=['exp-1'])  // pending
  → scheduler.dispatch() → ['exp-1']
  → engine.transition('exp-1', 'running')
  → contract.buildPrompt({ goal, constraints })
  → 注入到子代理 prompt 末尾
  → [子代理执行]
  → engine.transition('exp-1', 'completed')
  → contract.extract(子代理输出) → 存储
  → checkDependencies('fix-1') → pending→ready
  → syncTodo()
  → [失败分支]
  → retryManager.decide() → 'retry' / 'fallback' / 'abort'
  → cascadeCancel() 如果放弃
```

## 不修改的范围

- `TaskTracker`：保持现有 Job Board 渲染、质量回送、统计持久化、超时清理
- `context/`：现有 extractor 保留，contract 作为前置解析
- `tools/`：council 内部重试保留，新 retry 层在 engine 层不侵入 council
- `prompts/`：所有代理提示词不动（契约标记块是建议性输出，不强制）

## 工作量估算

| 文件 | 行数 |
|------|:----:|
| `src/orchestration/types.ts` | ~80 |
| `src/orchestration/engine.ts` | ~150 |
| `src/orchestration/retry.ts` | ~120 |
| `src/orchestration/contract.ts` | ~100 |
| `src/orchestration/scheduler.ts` | ~60 |
| `src/orchestration/index.ts` | ~40 |
| 修改 `src/index.ts`（集成） | ~30 |
| **合计** | **~580 行** |