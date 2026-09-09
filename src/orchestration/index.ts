// src/orchestration/index.ts
// Orchestration Engine — 统一导出 + 工厂函数

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
  const scheduler = new Scheduler(engine, config?.concurrency?.maxConcurrency);
  return { engine, contractMgr, retryMgr, scheduler };
}