// src/orchestration/engine.ts
// OrchestrationEngine — 六状态 DAG 状态机引擎

import { VALID_TRANSITIONS } from './types';
import type { OrchestrationTask, TaskState, AgentContract } from './types';
import type { ContractManager } from './contract';
import type { RetryManager, RetryDecision } from './retry';

export type { TaskState, RetryDecision };

// DAG 接口：任务有向无环图
interface DAG {
  tasks: Map<string, OrchestrationTask>;
}

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

    const allowed = VALID_TRANSITIONS[task.state as TaskState];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid transition: ${task.state} → ${to} for ${alias}`);
    }

    task.state = to;

    // 副作用
    if (to === 'completed') {
      for (const depAlias of task.dependents) {
        this.checkDependencies(depAlias);
      }
    }
    if (to === 'cancelled') {
      this.cascadeCancel(alias);
    }
  }

  private checkDependencies(alias: string): void {
    const task = this.dag.tasks.get(alias);
    if (!task || task.state !== 'pending') return;

    const allDone = task.deps.every((d: string) => {
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
    return 1 + Math.max(...task.deps.map((d: string) => this.calcDepth(d, visited)));
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