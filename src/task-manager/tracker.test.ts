// src/task-manager/tracker.test.ts
// 验证"关闭卡住子代理"相关能力：abortJob 定位/幂等/状态守卫、cleanupStaleJobs 超时清理

import type { JobRecord } from './types';
import { TaskTracker } from './tracker';

// ---- 最小化 bun:test 全局声明 ----
// Bun 运行时在全局注入 describe/test/expect；项目未安装 @types/bun，
// 因此用局部声明替代整文件 @ts-nocheck，使其余代码仍受类型检查约束。
interface ExpectResult {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  readonly not: Omit<ExpectResult, 'not'>;
}
declare function describe(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare function expect(actual: unknown): ExpectResult;

/** 访问 TaskTracker 私有字段 jobs（仅测试用，绕过 private 可见性检查） */
function getJobs(tracker: TaskTracker): Map<string, JobRecord> {
  return (tracker as unknown as { jobs: Map<string, JobRecord> }).jobs;
}

function registerBg(
  tracker: TaskTracker,
  opts: { sessionId?: string; parent?: string; ageMs?: number } = {},
): { alias: string; job: JobRecord } {
  const parent = opts.parent ?? 'parent-ses';
  const alias = tracker.registerBeforeTask(parent, {
    subagent_type: 'co-explorer',
    description: '测试背景任务',
    task_id: opts.sessionId ?? `ses_${Math.random().toString(36).slice(2, 10)}`,
    background: true,
  });
  const job = getJobs(tracker).get(alias);
  if (!job) throw new Error(`job ${alias} not found after registerBeforeTask`);
  if (opts.ageMs !== undefined) {
    job.createdAt = Date.now() - opts.ageMs;
  }
  return { alias, job };
}

describe('abortJob', () => {
  test('按 alias 定位：标记 cancelled、terminalReconciled=true、返回 sessionId', () => {
    const tracker = new TaskTracker();
    const { alias, job } = registerBg(tracker, { sessionId: 'ses_aaa', parent: 'p1' });

    const result = tracker.abortJob(alias);

    expect(result).toBeDefined();
    expect(result!.sessionId).toBe('ses_aaa');
    expect(result!.job).toBe(job);
    expect(job.status).toBe('cancelled');
    expect(job.terminalReconciled).toBe(true);
  });

  test('按 sessionId 匹配也生效', () => {
    const tracker = new TaskTracker();
    const { job } = registerBg(tracker, { sessionId: 'ses_bbb', parent: 'p1' });

    const result = tracker.abortJob('ses_bbb');

    expect(result).toBeDefined();
    expect(result!.sessionId).toBe('ses_bbb');
    expect(result!.job).toBe(job);
    expect(job.status).toBe('cancelled');
    expect(job.terminalReconciled).toBe(true);
  });

  test('未知 taskId：返回 undefined、不抛错', () => {
    const tracker = new TaskTracker();
    const { job } = registerBg(tracker, { sessionId: 'ses_ccc', parent: 'p1' });
    // 不干扰已有任务
    const before = job.status;

    const result = tracker.abortJob('no-such-alias');

    expect(result).toBeUndefined();
    expect(job.status).toBe(before);
  });

  test('pending 任务（无 sessionId）：返回 sessionId undefined、不抛错', () => {
    const tracker = new TaskTracker();
    // task_id 缺失 → JobRecord.sessionId 为 ''
    const alias = tracker.registerBeforeTask('p1', {
      subagent_type: 'co-fixer',
      description: '尚未拿到子 session 的任务',
      background: true,
    });
    const job = getJobs(tracker).get(alias);
    if (!job) throw new Error('job should exist');

    const result = tracker.abortJob(alias);

    expect(result).toBeDefined();
    expect(result!.sessionId).toBeUndefined();
    expect(result!.job).toBe(job);
    expect(job.status).toBe('cancelled');
  });

  test('重复 abort 幂等：已终态任务再次 abort 返回原状态、不重复改写', () => {
    const tracker = new TaskTracker();
    const { alias, job } = registerBg(tracker, { sessionId: 'ses_dup', parent: 'p1' });

    const first = tracker.abortJob(alias);
    expect(first).toBeDefined();
    expect(job.status).toBe('cancelled');

    // 第二次按 sessionId 再次 abort：守卫命中，返回同一 job 且状态保持 cancelled
    const second = tracker.abortJob('ses_dup');
    expect(second).toBeDefined();
    expect(second!.job).toBe(job);
    expect(second!.sessionId).toBe('ses_dup');
    expect(job.status).toBe('cancelled');
    expect(job.terminalReconciled).toBe(true);
  });

  test('状态守卫：completed 任务 abort 不改变状态', () => {
    const tracker = new TaskTracker();
    const { alias, job } = registerBg(tracker, { sessionId: 'ses_done', parent: 'p1' });
    job.status = 'completed';
    job.terminalReconciled = true;

    const result = tracker.abortJob(alias);

    expect(result).toBeDefined();
    expect(result!.job).toBe(job);
    expect(job.status).toBe('completed');
  });

  test('状态守卫：errored 任务 abort 不改变状态', () => {
    const tracker = new TaskTracker();
    const { alias, job } = registerBg(tracker, { sessionId: 'ses_err', parent: 'p1' });
    job.status = 'errored';

    const result = tracker.abortJob(alias);

    expect(result).toBeDefined();
    expect(result!.job).toBe(job);
    expect(job.status).toBe('errored');
  });
});

describe('cleanupStaleJobs', () => {
  test('过期的 background running job：返回其 sessionId、状态变为 errored', () => {
    const tracker = new TaskTracker();
    const stale = registerBg(tracker, { sessionId: 'ses_stale', parent: 'p1', ageMs: 100_000 });
    // 另一个未过期
    const fresh = registerBg(tracker, { sessionId: 'ses_fresh', parent: 'p1', ageMs: 1_000 });

    const staleSessions = tracker.cleanupStaleJobs(60_000);

    expect(staleSessions).toContain('ses_stale');
    expect(staleSessions).not.toContain('ses_fresh');
    expect(stale.job.status).toBe('errored');
  });

  test('未过期的 running job 不被标记', () => {
    const tracker = new TaskTracker();
    const alive = registerBg(tracker, { sessionId: 'ses_alive', parent: 'p1', ageMs: 10_000 });

    const staleSessions = tracker.cleanupStaleJobs(60_000);

    expect(staleSessions).toEqual([]);
    expect(alive.job.status).toBe('running');
  });

  test('非 background 的 running job 不被清理', () => {
    const tracker = new TaskTracker();
    const alias = tracker.registerBeforeTask('p1', {
      subagent_type: 'co-fixer',
      description: '前台任务',
      background: false,
    });
    const job = getJobs(tracker).get(alias);
    if (!job) throw new Error('job should exist');
    job.createdAt = Date.now() - 100_000;

    const staleSessions = tracker.cleanupStaleJobs(60_000);

    expect(staleSessions).toEqual([]);
    expect(job.status).toBe('running');
  });
});
