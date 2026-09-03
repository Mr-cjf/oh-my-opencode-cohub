// src/orchestration/scheduler.ts
// Scheduler — 按 maxConcurrency 限流调度，不重复派遣已派遣的任务

import { OrchestrationEngine } from './engine';

export class Scheduler {
  private engine: OrchestrationEngine;
  private maxConcurrency: number;
  private dispatched = new Set<string>();  // 已派遣但未完成的任务

  constructor(engine: OrchestrationEngine, maxConcurrency: number = 20) {
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