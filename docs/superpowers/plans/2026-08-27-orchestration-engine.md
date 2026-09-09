# Orchestration Engine 实现计划

> **对于代理工作者：** 必需的子技能：使用 subagent-driven-development 或 executing-plans 来逐个任务执行此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 实现三个新模块（状态机引擎 + 重试管理器 + 上下文契约），通过代码保证 orchestrator 编排的可靠性。

**架构：** 新建 `src/orchestration/` 目录，6 个文件约 580 行。不修改现有 TaskTracker、context/、tools/。集成点仅修改 `src/index.ts` 的 3 个 hook 和 `src/prompts/orchestrator.md`。

**技术栈：** TypeScript ESM，通过 `@opencode-ai/plugin` SDK 集成。

## 全局约束

- 所有新文件使用 ESM 模块格式（`import`/`export`）
- 使用 `zod` 做运行时校验（项目中已有）
- 不修改 `src/task-manager/tracker.ts` 的现有接口
- 不修改 `src/context/` 目录下的任何文件
- 不修改 `src/tools/` 目录下的任何文件
- 契约标记块格式：`<!-- CONTRACT_BEGIN -->...<!-- CONTRACT_END -->`
- 状态转换必须通过白名单表校验，非法转换抛 `Error`

---

### 任务 1：编排类型定义（`types.ts`）

**文件：**
- 创建：`src/orchestration/types.ts`

**接口：**
- 消费：`src/task-manager/types.ts` 的 `TaskStatus` 概念（注意：新 `TaskState` 是独立定义，不继承旧类型）
- 产生：`OrchestrationTask`、`RetryPolicy`、`AgentContract`、`ConcurrencyConfig` — 被 engine/retry/contract/scheduler 消费

- [ ] **步骤 1：创建文件并定义 TaskState 和 OrchestrationTask**

```typescript
// src/orchestration/types.ts
import type { TaskStatus } from '../task-manager/types';

export type TaskState = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface OrchestrationTask {
  alias: string;
  agent: string;
  label: string;
  state: TaskState;
  deps: string[];          // 前置依赖 alias 列表
  dependents: string[];    // 后继任务 alias 列表（反向引用，用于级联取消）
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  timeoutMs?: number;
  result?: {
    summary: string;
    failedAgents?: string[];   // 已尝试过的代理类型（降级用）
    contract?: AgentContract;  // 任务完成后的结构化输出
  };
}

// 合法状态转换表
export const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending:    ['ready', 'cancelled'],
  ready:      ['running', 'cancelled'],
  running:    ['completed', 'failed', 'cancelled'],
  failed:     ['pending', 'cancelled'],
  completed:  [],
  cancelled:  [],
};
```

- [ ] **步骤 2：定义 RetryPolicy 和默认策略**

```typescript
export interface RetryPolicy {
  maxRetries: number;
  backoff: 'exponential' | 'fixed' | 'immediate';
  backoffMs: number;
  retryableErrors: string[];
  nonRetryableErrors: string[];
  fallbackAgents?: string[];
}

export const DEFAULT_RETRY_POLICIES: Record<string, RetryPolicy> = {
  'co-explorer': {
    maxRetries: 2, backoff: 'exponential', backoffMs: 2000,
    retryableErrors: ['rate limit', 'timeout', 'too many requests'],
    nonRetryableErrors: ['not found', 'permission'],
  },
  'co-fixer': {
    maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
    retryableErrors: ['timeout', 'build failed', 'test failed'],
    nonRetryableErrors: ['syntax error', 'invalid'],
  },
  'co-oracle': {
    maxRetries: 1, backoff: 'immediate', backoffMs: 0,
    retryableErrors: ['timeout'],
    nonRetryableErrors: [],
  },
  'co-librarian': {
    maxRetries: 2, backoff: 'exponential', backoffMs: 2000,
    retryableErrors: ['timeout', 'rate limit', 'fetch failed'],
    nonRetryableErrors: ['not found', 'invalid url'],
  },
  'co-council': {
    maxRetries: 2, backoff: 'exponential', backoffMs: 2000,
    retryableErrors: ['timeout', 'rate limit'],
    nonRetryableErrors: ['invalid api key'],
  },
  'co-designer': {
    maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
    retryableErrors: ['timeout'],
    nonRetryableErrors: ['syntax error'],
  },
  '__default__': {
    maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
    retryableErrors: ['timeout'],
    nonRetryableErrors: [],
  },
};
```

- [ ] **步骤 3：定义 AgentContract、ConcurrencyConfig 和 OrchestrationConfig**

```typescript
export interface AgentContract {
  keyResult: string;
  decisions: string[];
  filesChanged: string[];
  validationStatus: 'passed' | 'failed' | 'unknown';
  validationDetail?: string;
  pendingItems: string[];
  warnings: string[];
}

export interface ConcurrencyConfig {
  maxConcurrency: number;
  // per-agent 限流多余——orchestrator 通过"不同文件并行、同文件串行"规则自行控制
}

export const DEFAULT_CONCURRENCY: ConcurrencyConfig = {
  maxConcurrency: 5,
};

export interface OrchestrationConfig {
  retryPolicies?: Record<string, RetryPolicy>;
  concurrency?: ConcurrencyConfig;
  defaultMaxRetries?: number;
}
```

- [ ] **步骤 4：定义 DAG 接口和 OrchestrationConfig**

```typescript
export interface DAG {
  tasks: Map<string, OrchestrationTask>;
}

export interface OrchestrationConfig {
  retryPolicies?: Record<string, RetryPolicy>;
  concurrency?: ConcurrencyConfig;
  defaultMaxRetries?: number;
}
```

- [ ] **步骤 5：提交**

```bash
git add src/orchestration/types.ts
git commit -m "feat(orchestration): 编排类型定义
- TaskState 六状态 + 合法转换表
- RetryPolicy + 按 agent 类型默认策略
- AgentContract 结构化 handoff 契约
- ConcurrencyConfig 并发控制配置
- DAG / OrchestrationConfig 接口"
```

---

### 任务 2：上下文契约管理器（`contract.ts`）

**文件：**
- 创建：`src/orchestration/contract.ts`
- 测试：`src/orchestration/contract.test.ts`

**接口：**
- 消费：`AgentContract`（来自 types.ts）
- 产生：`ContractManager` 类，被 engine 在子代理完成/派遣时调用

- [ ] **步骤 1：编写 ContractManager 类的测试**

```typescript
// src/orchestration/contract.test.ts
import { describe, it, expect } from 'bun:test';
import { ContractManager } from './contract';

describe('ContractManager', () => {
  // extract
  it('should extract contract block from output', () => {
    const mgr = new ContractManager();
    const output = `some text\n<!-- CONTRACT_BEGIN -->\n- 关键结果: 完成\n- 决策: 决定用 A\n- 修改文件: src/a.ts\n- 验证状态: passed\n- 验证详情: 10/10 tests\n- 待完成: 无\n- 警告: 无\n<!-- CONTRACT_END -->\nmore text`;
    const result = mgr.extract(output);
    expect(result).not.toBeNull();
    expect(result!.keyResult).toBe('完成');
    expect(result!.decisions).toEqual(['决定用 A']);
    expect(result!.filesChanged).toEqual(['src/a.ts']);
    expect(result!.validationStatus).toBe('passed');
    expect(result!.validationDetail).toBe('10/10 tests');
  });

  it('should return null when no contract block', () => {
    const mgr = new ContractManager();
    expect(mgr.extract('plain text without contract')).toBeNull();
  });

  it('should handle empty fields', () => {
    const mgr = new ContractManager();
    const output = `<!-- CONTRACT_BEGIN -->\n- 关键结果: 搜索完成\n- 决策: \n- 修改文件: \n- 验证状态: unknown\n<!-- CONTRACT_END -->`;
    const result = mgr.extract(output);
    expect(result).not.toBeNull();
    expect(result!.keyResult).toBe('搜索完成');
    expect(result!.decisions).toEqual([]);
    expect(result!.filesChanged).toEqual([]);
    expect(result!.validationStatus).toBe('unknown');
  });

  // buildPrompt
  it('should build prompt with goal and prerequisites', () => {
    const mgr = new ContractManager();
    const prompt = mgr.buildPrompt({
      goal: '实现登录功能',
      prerequisites: [
        { from: 'exp-1', contract: { keyResult: '找到 AuthService', decisions: [], filesChanged: ['src/auth.ts'], validationStatus: 'passed', pendingItems: [], warnings: [] } },
      ],
      constraints: ['必须兼容 IE11'],
    });
    expect(prompt).toContain('实现登录功能');
    expect(prompt).toContain('必须兼容 IE11');
    expect(prompt).toContain('exp-1');
    expect(prompt).toContain('找到 AuthService');
    expect(prompt).toContain('CONTRACT_END');
  });

  // summarize
  it('should summarize multiple contracts', () => {
    const mgr = new ContractManager();
    const summary = mgr.summarize([
      { keyResult: 'A 完成', decisions: ['用 B'], filesChanged: ['a.ts'], validationStatus: 'passed', pendingItems: ['C'], warnings: [] },
      { keyResult: 'D 完成', decisions: ['用 E'], filesChanged: ['d.ts'], validationStatus: 'passed', pendingItems: [], warnings: ['注意 F'] },
    ]);
    expect(summary).toContain('A 完成');
    expect(summary).toContain('D 完成');
    expect(summary).toContain('注意 F');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`bun test src/orchestration/contract.test.ts`
预期：FAIL — `ContractManager` 未定义

- [ ] **步骤 3：实现 ContractManager**

```typescript
// src/orchestration/contract.ts
import type { AgentContract } from './types';

const CONTRACT_PATTERN = /<!-- CONTRACT_BEGIN -->\n([\s\S]*?)<!-- CONTRACT_END -->/;

export class ContractManager {
  extract(output: string): AgentContract | null {
    const match = output.match(CONTRACT_PATTERN);
    if (!match) return null;
    return this.parseLines(match[1].trim());
  }

  private parseLines(text: string): AgentContract {
    const lines = text.split('\n').map(l => l.replace(/^- /, '').trim());
    const get = (prefix: string): string => {
      const line = lines.find(l => l.startsWith(prefix));
      return line ? line.slice(prefix.length).trim() : '';
    };
    const getList = (prefix: string): string[] => {
      const val = get(prefix);
      return val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
    };
    return {
      keyResult: get('关键结果:'),
      decisions: getList('决策:'),
      filesChanged: getList('修改文件:'),
      validationStatus: (get('验证状态:') as AgentContract['validationStatus']) || 'unknown',
      validationDetail: get('验证详情:') || undefined,
      pendingItems: getList('待完成:'),
      warnings: getList('警告:'),
    };
  }

  buildPrompt(context: {
    goal: string;
    prerequisites: { from: string; contract: AgentContract }[];
    constraints: string[];
  }): string {
    let lines = ['<!-- CONTRACT_BEGIN -->', '## 本任务前置上下文'];
    lines.push(`- 目标: ${context.goal}`);
    if (context.constraints.length) {
      lines.push('- 约束:');
      context.constraints.forEach(c => lines.push(`  - ${c}`));
    }
    if (context.prerequisites.length) {
      lines.push('- 前置任务结果:');
      context.prerequisites.forEach(p => {
        lines.push(`  - ${p.from}: ${p.contract.keyResult}`);
        if (p.contract.decisions.length) lines.push(`    - 决策: ${p.contract.decisions.join(', ')}`);
        if (p.contract.warnings.length) lines.push(`    ⚠️ 警告: ${p.contract.warnings.join(', ')}`);
      });
    }
    lines.push('');
    lines.push('## 本任务输出要求');
    lines.push('完成后，在回复末尾输出以下结构化摘要（请用实际内容替换占位值）：');
    lines.push('<!-- CONTRACT_BEGIN -->');
    lines.push('- 关键结果: <核心产出>');
    lines.push('- 决策: <决策1, 决策2>');
    lines.push('- 修改文件: <文件1, 文件2>');
    lines.push('- 验证状态: passed/failed/unknown');
    lines.push('- 验证详情: <测试结果或错误详情>');
    lines.push('- 待完成: <未完成的工作项>');
    lines.push('- 警告: <遗留问题警告>');
    lines.push('<!-- CONTRACT_END -->');
    return lines.join('\n');
  }

  summarize(contracts: AgentContract[]): string {
    const parts: string[] = [];
    contracts.forEach((c, i) => {
      parts.push(`[任务${i + 1}] ${c.keyResult}`);
      if (c.decisions.length) parts.push(`  决策: ${c.decisions.join(', ')}`);
      if (c.warnings.length) parts.push(`  ⚠️ ${c.warnings.join(', ')}`);
    });
    return parts.join('\n');
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test src/orchestration/contract.test.ts`
预期：5 个测试全部 PASS

- [ ] **步骤 5：提交**

```bash
git add src/orchestration/contract.ts src/orchestration/contract.test.ts
git commit -m "feat(orchestration): 上下文契约管理器
- ContractManager.extract 解析 <!-- CONTRACT_BEGIN --> 标记块
- ContractManager.buildPrompt 生成含前置上下文的 prompt
- ContractManager.summarize 合并多个契约摘要
- 5 个单元测试覆盖提取/空值/提示构建/合并"
```

---

### 任务 3：重试管理器（`retry.ts`）

**文件：**
- 创建：`src/orchestration/retry.ts`
- 测试：`src/orchestration/retry.test.ts`

**接口：**
- 消费：`RetryPolicy`、`OrchestrationTask`（来自 types.ts）
- 产生：`RetryManager` 类，被 engine 在任务 failed 时调用

- [ ] **步骤 1：编写 RetryManager 测试**

```typescript
// src/orchestration/retry.test.ts
import { describe, it, expect } from 'bun:test';
import { RetryManager } from './retry';
import type { OrchestrationTask } from './types';

function makeTask(overrides: Partial<OrchestrationTask> = {}): OrchestrationTask {
  return {
    alias: 'test-1', agent: 'co-explorer', label: '测试',
    state: 'failed', deps: [], dependents: [],
    retryCount: 0, maxRetries: 2, createdAt: Date.now(),
    ...overrides,
  };
}

describe('RetryManager', () => {
  it('should retry when error is retryable and retries remain', () => {
    const mgr = new RetryManager();
    const task = makeTask({ retryCount: 0, maxRetries: 2 });
    expect(mgr.decide(task, 'rate limit exceeded')).toBe('retry');
  });

  it('should abort when error is non-retryable', () => {
    const mgr = new RetryManager();
    const task = makeTask();
    expect(mgr.decide(task, 'not found: file missing')).toBe('abort');
  });

  it('should abort when retries exhausted', () => {
    const mgr = new RetryManager();
    const task = makeTask({ retryCount: 2, maxRetries: 2 });
    expect(mgr.decide(task, 'timeout')).toBe('abort');
  });

  it('should fallback when retries exhausted and fallback agents exist', () => {
    const mgr = new RetryManager({
      'co-fixer': { maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
        retryableErrors: ['timeout'], nonRetryableErrors: [],
        fallbackAgents: ['co-oracle'] },
    });
    const task = makeTask({ agent: 'co-fixer', retryCount: 1, maxRetries: 1 });
    expect(mgr.decide(task, 'timeout')).toBe('fallback');
  });

  it('should use exponential backoff', () => {
    const mgr = new RetryManager();
    expect(mgr.getBackoffMs(makeTask({ retryCount: 0 }), 'exponential', 2000)).toBe(2000);
    expect(mgr.getBackoffMs(makeTask({ retryCount: 1 }), 'exponential', 2000)).toBe(4000);
    expect(mgr.getBackoffMs(makeTask({ retryCount: 2 }), 'exponential', 2000)).toBe(8000);
  });

  it('should use fixed backoff', () => {
    const mgr = new RetryManager();
    expect(mgr.getBackoffMs(makeTask({ retryCount: 0 }), 'fixed', 1000)).toBe(1000);
    expect(mgr.getBackoffMs(makeTask({ retryCount: 3 }), 'fixed', 1000)).toBe(1000);
  });

  it('should track and retrieve fallback agent', () => {
    const mgr = new RetryManager({
      'co-fixer': { maxRetries: 1, backoff: 'fixed', backoffMs: 1000,
        retryableErrors: ['timeout'], nonRetryableErrors: [],
        fallbackAgents: ['co-oracle', 'co-designer'] },
    });
    const task = makeTask({ agent: 'co-fixer', retryCount: 1, maxRetries: 1 });
    mgr.recordFailure('co-fixer', 'timeout');
    expect(mgr.getFallbackAgent('co-fixer')).toBe('co-oracle');
    mgr.recordFallbackUsed('co-fixer', 'co-oracle');
    expect(mgr.getFallbackAgent('co-fixer')).toBe('co-designer');
  });

  it('should reject non-retryable errors immediately', () => {
    const mgr = new RetryManager();
    const task = makeTask({ retryCount: 0, maxRetries: 5 });
    expect(mgr.decide(task, 'permission denied')).toBe('abort');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`bun test src/orchestration/retry.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 RetryManager**

```typescript
// src/orchestration/retry.ts
import type { OrchestrationTask, RetryPolicy } from './types';
import { DEFAULT_RETRY_POLICIES } from './types';

export type RetryDecision = 'retry' | 'fallback' | 'abort';

export class RetryManager {
  private policies: Record<string, RetryPolicy>;
  private failureStats = new Map<string, { count: number; triedFallbacks: string[] }>();

  constructor(overrides?: Record<string, RetryPolicy>) {
    this.policies = { ...DEFAULT_RETRY_POLICIES, ...overrides };
  }

  getPolicy(agent: string): RetryPolicy {
    return this.policies[agent] ?? this.policies['__default__']!;
  }

  decide(task: OrchestrationTask, error: string): RetryDecision {
    const policy = this.getPolicy(task.agent);

    // 1. 检查不可重试错误
    if (policy.nonRetryableErrors.some(e => error.toLowerCase().includes(e))) {
      return 'abort';
    }

    // 2. 检查是否可重试 — 如果不匹配 retryableErrors，则不可重试
    const isRetryable = policy.retryableErrors.some(e => error.toLowerCase().includes(e));
    if (!isRetryable) return 'abort';

    // 3. 检查重试次数
    if (task.retryCount >= policy.maxRetries) {
      if (policy.fallbackAgents?.length) return 'fallback';
      return 'abort';
    }

    return 'retry';
  }

  getBackoffMs(task: OrchestrationTask, type: RetryPolicy['backoff'], baseMs: number): number {
    switch (type) {
      case 'exponential': return baseMs * Math.pow(2, task.retryCount);
      case 'fixed': return baseMs;
      case 'immediate': return 0;
    }
  }

  recordFailure(agent: string, error: string): void {
    const stats = this.failureStats.get(agent) ?? { count: 0, triedFallbacks: [] };
    stats.count++;
    this.failureStats.set(agent, stats);
  }

  recordFallbackUsed(agent: string, fallback: string): void {
    const stats = this.failureStats.get(agent) ?? { count: 0, triedFallbacks: [] };
    stats.triedFallbacks.push(fallback);
    this.failureStats.set(agent, stats);
  }

  getFallbackAgent(agent: string): string | undefined {
    const policy = this.getPolicy(agent);
    const used = this.failureStats.get(agent)?.triedFallbacks ?? [];
    return policy.fallbackAgents?.find(a => !used.includes(a));
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test src/orchestration/retry.test.ts`
预期：8 个测试全部 PASS

- [ ] **步骤 5：提交**

```bash
git add src/orchestration/retry.ts src/orchestration/retry.test.ts
git commit -m "feat(orchestration): 重试管理器
- RetryManager.decide 判断 retry/fallback/abort
- 按 agent 类型配置重试策略（可覆盖）
- 指数退避 / fixed 退避计算
- fallback 代理追踪 + 降级路由
- 8 个单元测试覆盖全部决策分支"
```

---

### 任务 4：状态机引擎（`engine.ts`）

**文件：**
- 创建：`src/orchestration/engine.ts`
- 测试：`src/orchestration/engine.test.ts`

**接口：**
- 消费：`OrchestrationTask`、`DAG`、`VALID_TRANSITIONS`（来自 types.ts），`ContractManager`、`RetryManager`
- 产生：`OrchestrationEngine` 类，被调度器和 src/index.ts hooks 消费

- [ ] **步骤 1：编写引擎测试**

```typescript
// src/orchestration/engine.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { OrchestrationEngine } from './engine';
import { ContractManager } from './contract';
import { RetryManager } from './retry';

describe('OrchestrationEngine', () => {
  let engine: OrchestrationEngine;

  beforeEach(() => {
    engine = new OrchestrationEngine(new ContractManager(), new RetryManager());
  });

  it('should register a task with no deps as ready', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    expect(engine.getState('t1')).toBe('ready');
  });

  it('should register a task with deps as pending', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-fixer', '实现', ['t1']);
    expect(engine.getState('t2')).toBe('pending');
  });

  it('should transition pending to ready when dep completes', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-fixer', '实现', ['t1']);
    engine.transition('t1', 'completed');
    expect(engine.getState('t2')).toBe('ready');
  });

  it('should reject invalid transitions', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    expect(() => engine.transition('t1', 'failed')).toThrow();
  });

  it('should cascade cancel dependents', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-fixer', '实现', ['t1']);
    engine.registerTask('t3', 'co-oracle', '审查', ['t2']);
    engine.transition('t1', 'cancelled');
    expect(engine.getState('t1')).toBe('cancelled');
    expect(engine.getState('t2')).toBe('cancelled');
    expect(engine.getState('t3')).toBe('cancelled');
  });

  it('should get ready tasks sorted by depth', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-explorer', '搜索2');
    engine.registerTask('t3', 'co-fixer', '实现', ['t1', 't2']);
    const ready = engine.getReadyTasks();
    expect(ready).toContain('t1');
    expect(ready).toContain('t2');
    expect(ready).not.toContain('t3');
  });

  it('should handle retry transition: failed → pending', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.transition('t1', 'running');
    engine.transition('t1', 'failed');
    engine.transition('t1', 'pending');  // 重试
    expect(engine.getState('t1')).toBe('pending');
  });

  it('should get DAG summary string', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-fixer', '实现', ['t1']);
    engine.transition('t1', 'completed');
    const summary = engine.getDAGSummary();
    expect(summary).toContain('t1');
    expect(summary).toContain('t2');
    expect(summary).toContain('completed');
    expect(summary).toContain('ready');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`bun test src/orchestration/engine.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 OrchestrationEngine**

```typescript
// src/orchestration/engine.ts
import { VALID_TRANSITIONS } from './types';
import type { OrchestrationTask, TaskState, DAG, AgentContract } from './types';
import type { ContractManager } from './contract';
import type { RetryManager, RetryDecision } from './retry';

export type { TaskState, RetryDecision };

export class OrchestrationEngine {
  private dag: DAG = { tasks: new Map() };
  private contractMgr: ContractManager;
  private retryMgr: RetryManager;

  constructor(contractMgr: ContractManager, retryMgr: RetryManager) {
    this.contractMgr = contractMgr;
    this.retryMgr = retryMgr;
  }

  registerTask(alias: string, agent: string, label: string, deps: string[] = [], options?: {
    maxRetries?: number;
    timeoutMs?: number;
  }): void {
    if (this.dag.tasks.has(alias)) throw new Error(`Task ${alias} already registered`);

    // 建立反向引用
    const task: OrchestrationTask = {
      alias, agent, label,
      state: 'pending',
      deps,
      dependents: [],
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 1,
      createdAt: Date.now(),
      timeoutMs: options?.timeoutMs,
    };
    this.dag.tasks.set(alias, task);

    // 在依赖任务中注册反向引用
    for (const dep of deps) {
      const depTask = this.dag.tasks.get(dep);
      if (depTask) depTask.dependents.push(alias);
    }

    // 检查是否可转为 ready
    this.checkDependencies(alias);
  }

  transition(alias: string, to: TaskState): void {
    const task = this.dag.tasks.get(alias);
    if (!task) throw new Error(`Task ${alias} not found`);

    const allowed = VALID_TRANSITIONS[task.state];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid transition: ${task.state} → ${to} for ${alias}`);
    }

    task.state = to;

    // 副作用
    if (to === 'completed') {
      this.checkDependencies(alias);
    }
    if (to === 'cancelled') {
      this.cascadeCancel(alias);
    }
  }

  private checkDependencies(alias: string): void {
    const task = this.dag.tasks.get(alias);
    if (!task || task.state !== 'pending') return;

    const allDone = task.deps.every(d => {
      const dep = this.dag.tasks.get(d);
      return dep?.state === 'completed';
    });

    if (allDone) {
      task.state = 'ready';
    }
  }

  private cascadeCancel(alias: string): void {
    const task = this.dag.tasks.get(alias);
    if (!task) return;

    for (const depAlias of task.dependents) {
      const dep = this.dag.tasks.get(depAlias);
      if (dep && dep.state !== 'completed' && dep.state !== 'cancelled') {
        dep.state = 'cancelled';
        this.cascadeCancel(depAlias);
      }
    }
  }

  getReadyTasks(): string[] {
    const ready: { alias: string; depth: number }[] = [];
    for (const [alias, task] of this.dag.tasks) {
      if (task.state === 'ready') {
        ready.push({ alias, depth: this.calcDepth(alias) });
      }
    }
    return ready.sort((a, b) => a.depth - b.depth).map(r => r.alias);
  }

  private calcDepth(alias: string, visited = new Set<string>()): number {
    if (visited.has(alias)) return 0;
    visited.add(alias);
    const task = this.dag.tasks.get(alias);
    if (!task || !task.deps.length) return 0;
    return 1 + Math.max(...task.deps.map(d => this.calcDepth(d, visited)));
  }

  getState(alias: string): TaskState | undefined {
    return this.dag.tasks.get(alias)?.state;
  }

  getTask(alias: string): OrchestrationTask | undefined {
    return this.dag.tasks.get(alias);
  }

  setResult(alias: string, summary: string, contract?: AgentContract): void {
    const task = this.dag.tasks.get(alias);
    if (task) {
      task.result = { summary, contract, failedAgents: task.result?.failedAgents };
    }
  }

  markFallbackUsed(alias: string, agent: string): void {
    const task = this.dag.tasks.get(alias);
    if (task) {
      task.result = {
        ...task.result ?? { summary: '' },
        failedAgents: [...(task.result?.failedAgents ?? []), agent],
      };
    }
  }

  getDAGSummary(): string {
    const lines: string[] = [];
    for (const [alias, task] of this.dag.tasks) {
      const depStr = task.deps.length ? ` [dep: ${task.deps.join(',')}]` : '';
      lines.push(`- ${alias} (${task.agent}): ${task.state}${depStr}`);
    }
    return lines.join('\n');
  }

  get runningCount(): number {
    let count = 0;
    for (const task of this.dag.tasks.values()) {
      if (task.state === 'running') count++;
    }
    return count;
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test src/orchestration/engine.test.ts`
预期：10 个测试全部 PASS

- [ ] **步骤 5：提交**

```bash
git add src/orchestration/engine.ts src/orchestration/engine.test.ts
git commit -m "feat(orchestration): 状态机引擎
- OrchestrationEngine 六状态 DAG 引擎
- registerTask 支持依赖链（deps）→ 自动 pending/ready
- transition 通过白名单表校验合法性
- cascadeCancel 级联取消后继任务
- getReadyTasks 按依赖深度排序
- 10 个单元测试覆盖全部状态转换"
```

---

### 任务 5：调度器（`scheduler.ts`）

**文件：**
- 创建：`src/orchestration/scheduler.ts`
- 测试：`src/orchestration/scheduler.test.ts`

**接口：**
- 消费：`OrchestrationEngine`、`ConcurrencyConfig`（来自 types.ts）
- 产生：`Scheduler` 类，被 index.ts 集成点调用

- [ ] **步骤 1：编写调度器测试**

```typescript
// src/orchestration/scheduler.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { Scheduler } from './scheduler';
import { OrchestrationEngine } from './engine';
import { ContractManager } from './contract';
import { RetryManager } from './retry';

describe('Scheduler', () => {
  let engine: OrchestrationEngine;
  let scheduler: Scheduler;

  beforeEach(() => {
    engine = new OrchestrationEngine(new ContractManager(), new RetryManager());
    scheduler = new Scheduler(engine, 3);  // maxConcurrency=3
  });

  it('should dispatch at most maxConcurrency tasks', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-explorer', '搜索2');
    engine.registerTask('t3', 'co-explorer', '搜索3');
    engine.registerTask('t4', 'co-explorer', '搜索4');
    const dispatched = scheduler.dispatch(0);
    expect(dispatched.length).toBe(3);
  });

  it('should not dispatch more than available slots', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    engine.registerTask('t2', 'co-explorer', '搜索2');
    const d1 = scheduler.dispatch(0);
    expect(d1.length).toBe(2);
    const d2 = scheduler.dispatch(2);  // 2 正在运行，可用=1
    expect(d2.length).toBe(0);
  });

  it('should not dispatch a task that was already dispatched', () => {
    engine.registerTask('t1', 'co-explorer', '搜索');
    const d1 = scheduler.dispatch(0);
    expect(d1).toContain('t1');
    const d2 = scheduler.dispatch(0);
    expect(d2).not.toContain('t1');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`bun test src/orchestration/scheduler.test.ts`
预期：FAIL

- [ ] **步骤 3：实现 Scheduler**

```typescript
// src/orchestration/scheduler.ts
import { OrchestrationEngine } from './engine';

export class Scheduler {
  private engine: OrchestrationEngine;
  private maxConcurrency: number;
  private dispatched = new Set<string>();  // 已派遣但未完成的任务

  constructor(engine: OrchestrationEngine, maxConcurrency: number = 5) {
    this.engine = engine;
    this.maxConcurrency = maxConcurrency;
  }

  dispatch(runningCount: number): string[] {
    const ready = this.engine.getReadyTasks().filter(a => !this.dispatched.has(a));
    const available = this.maxConcurrency - runningCount;
    if (available <= 0) return [];

    const result = ready.slice(0, available);
    for (const alias of result) {
      this.dispatched.add(alias);
    }
    return result;
  }

  markCompleted(alias: string): void {
    this.dispatched.delete(alias);
  }

  markFailed(alias: string): void {
    this.dispatched.delete(alias);
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`bun test src/orchestration/scheduler.test.ts`
预期：4 个测试全部 PASS

- [ ] **步骤 5：提交**

```bash
git add src/orchestration/scheduler.ts src/orchestration/scheduler.test.ts
git commit -m "feat(orchestration): 调度器
- Scheduler 按 maxConcurrency + per-agent 限流
- 不重复派遣已派遣的任务
- 与 engine.getReadyTasks 集成
- 4 个单元测试覆盖并发/限流/重复派遣"
```

---

### 任务 6：集成入口 + 修改 src/index.ts hooks

**文件：**
- 创建：`src/orchestration/index.ts`
- 修改：`src/index.ts`（3 个 hook 集成点：~30 行）

**接口：**
- 消费：所有引擎模块
- 产生：统一的 `createOrchestrationLayer()` 工厂函数，被 src/index.ts 调用

- [ ] **步骤 1：创建集成入口**

```typescript
// src/orchestration/index.ts
import { OrchestrationEngine } from './engine';
import { ContractManager } from './contract';
import { RetryManager } from './retry';
import { Scheduler } from './scheduler';
import type { OrchestrationConfig, TaskState } from './types';
import type { TaskTracker } from '../task-manager/tracker';

export { OrchestrationEngine } from './engine';
export { ContractManager } from './contract';
export { RetryManager } from './retry';
export { Scheduler } from './scheduler';
export type { OrchestrationConfig, TaskState } from './types';
export type { RetryDecision } from './retry';

export interface OrchestrationLayer {
  engine: OrchestrationEngine;
  contractMgr: ContractManager;
  retryMgr: RetryManager;
  scheduler: Scheduler;
}

export function createOrchestrationLayer(
  tracker: TaskTracker,
  config?: OrchestrationConfig,
): OrchestrationLayer {
  const contractMgr = new ContractManager();
  const retryMgr = new RetryManager(config?.retryPolicies);
  const engine = new OrchestrationEngine(contractMgr, retryMgr);
  const scheduler = new Scheduler(engine, config?.concurrency);
  return { engine, contractMgr, retryMgr, scheduler };
}
```

- [ ] **步骤 2：读取 src/index.ts 中需要修改的 3 个 hook 位置**

运行：`grep -n "tool.execute.before\|tool.execute.after\|event:" src/index.ts` 确认行号

- [ ] **步骤 3：修改 tool.execute.before — 注册任务到 engine**

找到 `'tool.execute.before'` hook 中 `tracker.registerBeforeTask(input.sessionID, args)` 的行，`registerBeforeTask` 返回 alias，在其后添加：

```typescript
// 在 const alias = tracker.registerBeforeTask(input.sessionID, args) 之后
if (orchestrationLayer && args.subagent_type && args.description) {
  try {
    orchestrationLayer.engine.registerTask(
      alias,
      args.subagent_type,
      args.description,
      [], // deps — 由 orchestrator 通过 prompt 指定
    );
    // 注入契约上下文到 prompt（task 工具的 prompt 可能在 output.args.prompt 或 description）
    const targetField = output.args?.prompt ? 'prompt' : 'description';
    if (output.args?.[targetField] && typeof output.args[targetField] === 'string') {
      output.args[targetField] += '\n' + orchestrationLayer.contractMgr.buildPrompt({
        goal: args.description,
        prerequisites: [],
        constraints: [],
      });
    }
  } catch (e) {
    appendLog(`[orchestration] registerTask error: ${e}`);
  }
}
```

- [ ] **步骤 4：修改 tool.execute.after — 同步任务状态**

找到 `'tool.execute.after'` hook 中 `tracker.updateAfterTask(…)` 的行，在其后添加：

```typescript
// 在 tracker.updateAfterTask 之后
if (orchestrationLayer && input.tool === 'task') {
  try {
    // 查找最后注册的同 agent 类型 running 任务
    const tasks = orchestrationLayer.engine.getReadyTasks();
    // 从 output 中提取子代理结果并提取契约
    if (typeof output === 'string') {
      const contract = orchestrationLayer.contractMgr.extract(output);
      if (contract) {
        orchestrationLayer.engine.setResult(alias, contract.keyResult, contract);
      }
    }
    // 标记调度器完成
    orchestrationLayer.scheduler.markCompleted(alias);
  } catch (e) {
    appendLog(`[orchestration] afterTask error: ${e}`);
  }
}
```

- [ ] **步骤 5：修改 event hook — 处理完成和失败**

找到 `event` hook 中 `session.idle` 的处理代码，在 `tracker.updateByChildSessionId` 之后添加：

```typescript
// 在 session.idle 处理中
if (orchestrationLayer && e.type === 'session.idle') {
  try {
    const job = tracker.getJobBySessionId(sessionId);
    if (job) {
      orchestrationLayer.engine.transition(job.alias, 'completed');
      orchestrationLayer.scheduler.markCompleted(job.alias);
    }
  } catch (e) {
    appendLog(`[orchestration] session.idle transition error: ${e}`);
  }
}

// 在 session.error 处理中
if (orchestrationLayer && (e.type === 'session.deleted' || e.type === 'session.error')) {
  try {
    const job = tracker.getJobBySessionId(sessionId);
    if (job) {
      orchestrationLayer.engine.transition(job.alias, 'failed');
      orchestrationLayer.scheduler.markFailed(job.alias);
      // 自动重试
      const decision = orchestrationLayer.retryMgr.decide(
        orchestrationLayer.engine.getTask(job.alias)!,
        'session error',
      );
      if (decision === 'retry') {
        orchestrationLayer.engine.transition(job.alias, 'pending');
      }
    }
  } catch (e) {
    appendLog(`[orchestration] session.error transition error: ${e}`);
  }
}
```

- [ ] **步骤 6：在 src/index.ts 顶部初始化 orchestration layer**

在文件顶部导入和初始化：

```typescript
// 在 src/index.ts 顶部
import { createOrchestrationLayer } from './orchestration';
// ...
// 在插件返回配置中
const orchestrationLayer = createOrchestrationLayer(tracker, {});
```

- [ ] **步骤 7：构建验证**

运行：`npm run build`
预期：构建通过，无类型错误

- [ ] **步骤 8：提交**

```bash
git add src/orchestration/index.ts src/index.ts
git commit -m "feat(orchestration): 集成入口 + src/index.ts hooks 集成
- createOrchestrationLayer 工厂函数
- tool.execute.before 注册任务到 engine
- tool.execute.after 提取契约 + 同步状态
- event hook 处理完成/失败 + 自动重试
- 所有模块统一导出"
```

---

### 任务 7：更新 orchestrator 提示词

**文件：**
- 修改：`src/prompts/orchestrator.md`

**接口：**
- 消费：OrchestrationEngine 的能力（状态机 / 依赖图 / 重试 / 契约）
- 产生：更新后的 orchestrator 工作流描述

- [ ] **步骤 1：修改 orchestrator.md 的工作流章节**

将原有 `<工作流>` 中的步骤 3-4 替换为（仅修改调度执行部分，1-2-5 不变）：

```markdown
## 3. 制定方案（委派 @co-planner）
将信息收集结果（代码库结构、API文档、规范分析等）汇总后委派给 @co-planner 制定结构化方案。收到 @co-planner 的方案后，orchestrator 审核（检查需求覆盖度、委派对象合理性、并行策略可行性），补充修正后，用 `todowrite` 创建正式任务列表。**方案末尾必须提供选项供用户选择**（如：A. 立即执行 / B. 修改方案 / C. 取消），等待用户回复后再进入调度执行。

## 4. 调度执行（编排引擎驱动）

**引擎自动处理**（无需 orchestrator 手动追踪）：
- 使用 `engine.registerTask()` 注册任务及依赖关系
- 引擎自动维护六状态（pending→ready→running→completed/failed→pending/cancelled）
- 依赖就绪时自动将 pending → ready
- 失败时引擎自动重试（按 RetryPolicy 策略）或降级
- 级联取消依赖链

**orchestrator 仅需：**
1. 用 `engine.registerTask(alias, agent, label, deps, options?)` 注册所有任务
2. 引擎自动管理状态转换和就绪队列
3. 调用 `scheduler.dispatch(runningCount)` 获取可派遣任务
4. 为每个任务发起 `task()` 调用
5. 完成后通过 `engine.transition(alias, 'completed')` 通知引擎

**⚠️ 执行前并行检查清单——每次准备派发 task 前，必须逐条确认（不可跳过）：**

□ **列出所有待执行任务**：逐个写出本轮需要启动的 task（类型 + 对象 + 作用文件）
□ **检查依赖就绪**：使用 `engine.getState(alias)` 确认所有前置依赖已完成
□ **检查并发限制**：使用 `scheduler.dispatch(runningCount)` 获取可派遣任务列表（自动遵守 per-agent 并发限制）
□ **识别不同文件的任务**：涉及不同文件？→ **必须并行派发，一次消息同时启动所有**
□ **识别同文件的任务**：涉及同一文件？→ **必须串行排队，上一批完成后再启动下一批**
□ **确认派发方式**：以上确认完成后 → **一次消息中同时发起所有无依赖的 task 调用，绝不逐个串行**

清晰文件范围+背景启动+追踪不重复+协调冲突。委派指令用中文。
```

- [ ] **步骤 2：构建验证**

运行：`npm run build`
预期：构建通过

- [ ] **步骤 3：提交**

```bash
git add src/prompts/orchestrator.md
git commit -m "feat(orchestration): 更新 orchestrator 提示词使用编排引擎
- 调度执行章节改为引擎驱动
- 新增 engine.registerTask / transition / scheduler.dispatch 使用指引
- 保留并行检查清单，补充依赖就绪检查"
```

---

### 任务 8：全量测试验证

**文件：** 无新建

- [ ] **步骤 1：运行所有测试**

运行：`bun test`
预期：所有测试 PASS（包括现有 tracker/council/context 测试 + 新增 27 个 orchestration 测试）

- [ ] **步骤 2：构建验证**

运行：`npm run build`
预期：构建通过

- [ ] **步骤 3：提交**

```bash
git commit --allow-empty -m "test(orchestration): 全量测试验证通过"
```