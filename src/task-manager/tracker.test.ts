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

describe('getBoardText 折叠', () => {
  test('20 个活跃 job 只展示前 15 条 + 折叠提示', () => {
    const tracker = new TaskTracker();
    const parent = 'parent-fold';
    // 注册 20 个 running 背景任务
    for (let i = 0; i < 20; i++) {
      tracker.registerBeforeTask(parent, {
        subagent_type: 'co-explorer',
        description: `任务 ${i}`,
        task_id: `ses_fold_${i}`,
        background: true,
      });
    }

    const text = tracker.getBoardText(parent);

    // 包含前 15 条的任务条目
    expect(text).toContain('ses_fold_0');
    expect(text).toContain('ses_fold_14');
    // 不包含第 16 条之后的任务
    expect(text).not.toContain('ses_fold_15');
    expect(text).not.toContain('ses_fold_19');
    // 包含折叠提示
    expect(text).toContain('…及 5 个任务未显示');

    // 总行数验证：标题 + 条目 15 行 + 折叠 1 行 + 空行 = 18 行左右
    const lines = text.split('\n');
    const activeLines = lines.filter(l => l.startsWith('  - '));
    expect(activeLines.length).toBe(15);
  });

  test('少于 15 个活跃 job 不折叠', () => {
    const tracker = new TaskTracker();
    const parent = 'parent-no-fold';
    for (let i = 0; i < 10; i++) {
      tracker.registerBeforeTask(parent, {
        subagent_type: 'co-explorer',
        description: `任务 ${i}`,
        task_id: `ses_nofold_${i}`,
        background: true,
      });
    }

    const text = tracker.getBoardText(parent);

    expect(text).toContain('ses_nofold_0');
    expect(text).toContain('ses_nofold_9');
    expect(text).not.toContain('任务未显示');
  });
});

describe('pruneTerminalJobs', () => {
  test('删除超龄终态任务，保留活跃任务', () => {
    const tracker = new TaskTracker();
    const parent = 'parent-prune';
    const oldAge = 100_000; // 100秒前

    // 1. 创建超龄终态任务（completed + terminalReconciled + 旧时间）
    const oldAlias = tracker.registerBeforeTask(parent, {
      subagent_type: 'co-explorer',
      description: '超龄终态',
      task_id: 'ses_old_terminal',
      background: true,
    });
    const oldJob = getJobs(tracker).get(oldAlias)!;
    oldJob.status = 'completed';
    oldJob.terminalReconciled = true;
    oldJob.createdAt = Date.now() - oldAge;

    // 2. 创建活跃任务（running + 旧时间但不应被删）
    const runningAlias = tracker.registerBeforeTask(parent, {
      subagent_type: 'co-fixer',
      description: '活跃任务',
      task_id: 'ses_running_active',
      background: true,
    });
    const runningJob = getJobs(tracker).get(runningAlias)!;
    runningJob.createdAt = Date.now() - oldAge; // 虽然旧，但仍是 running

    // 3. 创建年轻终态任务（不应被删）
    const youngAlias = tracker.registerBeforeTask(parent, {
      subagent_type: 'co-planner',
      description: '年轻终态',
      task_id: 'ses_young_terminal',
      background: true,
    });
    const youngJob = getJobs(tracker).get(youngAlias)!;
    youngJob.status = 'completed';
    youngJob.terminalReconciled = true;
    // createdAt 保持默认（刚刚创建）

    const count = tracker.pruneTerminalJobs(60_000); // 60秒阈值

    expect(count).toBe(1); // 只删了超龄终态
    // 超龄终态已删除
    expect(getJobs(tracker).get(oldAlias)).toBeUndefined();
    // 活跃任务保留
    expect(getJobs(tracker).get(runningAlias)).toBeDefined();
    expect(runningJob.status).toBe('running');
    // 年轻终态保留
    expect(getJobs(tracker).get(youngAlias)).toBeDefined();
  });

  test('无超龄终态任务时返回 0', () => {
    const tracker = new TaskTracker();
    const parent = 'parent-none';
    tracker.registerBeforeTask(parent, {
      subagent_type: 'co-explorer',
      description: '活跃任务',
      task_id: 'ses_alive',
      background: true,
    });

    const count = tracker.pruneTerminalJobs(60_000);
    expect(count).toBe(0);
  });

  test('cancelled 终态任务也被清理', () => {
    const tracker = new TaskTracker();
    const parent = 'parent-cancelled';
    const oldAge = 100_000;

    const alias = tracker.registerBeforeTask(parent, {
      subagent_type: 'co-explorer',
      description: '已取消终态',
      task_id: 'ses_cancelled',
      background: true,
    });
    const job = getJobs(tracker).get(alias)!;
    job.status = 'cancelled';
    job.terminalReconciled = true;
    job.createdAt = Date.now() - oldAge;

    const count = tracker.pruneTerminalJobs(60_000);
    expect(count).toBe(1);
    expect(getJobs(tracker).get(alias)).toBeUndefined();
  });
});
