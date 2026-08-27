import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { JobRecord, TaskStatus, TaskArgs } from './types';
import type { ContextStrategy } from '../context/types';

// ===== 性能指标统计（T9）=====

/** 统计窗口默认大小：最近 N 条任务 */
export const DEFAULT_STATS_WINDOW = 50;

/** 统计持久化文件（CLI stats 子命令读取同一路径） */
export const STATS_FILE = path.join(
  os.homedir(),
  '.local',
  'share',
  'opencode',
  'storage',
  'oh-my-opencode-cohub',
  'stats.json',
);

/** 各代理的默认上下文策略（与 context/types.ts 默认配置一致；contextStrategy 未显式赋值时用于分组） */
const AGENT_DEFAULT_STRATEGY: Record<string, ContextStrategy> = {
  'co-fixer': 'relevant',
  'co-designer': 'relevant',
  'co-planner': 'relevant',
  'co-oracle': 'summary',
  'co-council': 'summary',
};

/** 按代理推断默认上下文策略 */
export function defaultStrategyFor(agent: string): ContextStrategy {
  return AGENT_DEFAULT_STRATEGY[agent] ?? 'none';
}

/** 参与统计的指标记录（从 JobRecord 抽取） */
export interface StatsRecord {
  agent: string;
  strategy: string;
  status: TaskStatus;
  latencyMs?: number;
  tokens?: { input: number; output: number };
}

/** 按 (strategy, agent) 聚合的统计桶 */
export interface StatsBucket {
  strategy: string;
  agent: string;
  count: number;
  successCount: number;
  successRate: number; // 0-100，无样本时为 0
  avgLatencyMs: number; // 仅有 latencyMs 样本的均值
  latencySamples: number;
  avgTokens: number; // input+output 总和均值，仅统计有 tokens 的样本
  tokenSamples: number;
}

/**
 * 滑动窗口聚合统计（纯函数）：
 * - records 需按时间升序传入，仅取最近 window 条
 * - 按 (strategy, agent) 分组，输出成功率 / 平均延迟 / 平均 token
 * - 缺少 latencyMs / tokens 的样本不影响对应均值，仅不计入样本数
 */
export function computeStats(records: StatsRecord[], window: number = DEFAULT_STATS_WINDOW): StatsBucket[] {
  const recent = records.slice(-Math.max(1, window));
  const buckets = new Map<string, StatsBucket>();
  for (const r of recent) {
    const key = r.strategy + '\u0000' + r.agent;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        strategy: r.strategy,
        agent: r.agent,
        count: 0,
        successCount: 0,
        successRate: 0,
        avgLatencyMs: 0,
        latencySamples: 0,
        avgTokens: 0,
        tokenSamples: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (r.status === 'completed') bucket.successCount += 1;
    if (typeof r.latencyMs === 'number') {
      bucket.avgLatencyMs = (bucket.avgLatencyMs * bucket.latencySamples + r.latencyMs) / (bucket.latencySamples + 1);
      bucket.latencySamples += 1;
    }
    if (r.tokens && typeof r.tokens.input === 'number' && typeof r.tokens.output === 'number') {
      const total = r.tokens.input + r.tokens.output;
      bucket.avgTokens = (bucket.avgTokens * bucket.tokenSamples + total) / (bucket.tokenSamples + 1);
      bucket.tokenSamples += 1;
    }
  }
  const result = Array.from(buckets.values());
  for (const b of result) {
    b.successRate = b.count > 0 ? (b.successCount / b.count) * 100 : 0;
  }
  result.sort((a, b) => a.strategy.localeCompare(b.strategy) || a.agent.localeCompare(b.agent));
  return result;
}

export class TaskTracker {
  private jobs = new Map<string, JobRecord>();
  private counters = new Map<string, number>();
  /** 最近一次 tool hook 收到的 parentSessionId */
  private _currentParentSessionId = '';
  /** 已 reconcile 的父 session ID，避免同一轮重复 reconcile */
  private _reconciledForParent = '';

  get currentParentSessionId(): string {
    return this._currentParentSessionId;
  }

  /** 生成代理别名，如 fixer → "fix-1", explorer → "exp-2" */
  private alias(agentType: string): string {
    const short = agentType.slice(0, 4).replace(/[^a-z]/gi, '');
    const n = (this.counters.get(agentType) ?? 0) + 1;
    this.counters.set(agentType, n);
    return `${short}-${n}`;
  }

  /**
   * 在 tool.execute.before 中调用，注册即将执行的任务
   */
  registerBeforeTask(parentSessionId: string, args: TaskArgs): string {
    this._currentParentSessionId = parentSessionId;
    // 每轮自动 reconcile 旧任务（只执行一次）
    if (this._reconciledForParent !== parentSessionId) {
      this._reconciledForParent = parentSessionId;
      for (const job of this.jobs.values()) {
        if (job.parentSessionId === parentSessionId && job.status !== 'running') {
          job.terminalReconciled = true;
        }
      }
    }
    const agent = args.subagent_type ?? 'unknown';
    const alias = this.alias(agent);
    const label = typeof args.description === 'string' && args.description ? args.description : alias;

    this.jobs.set(alias, {
      alias,
      sessionId: args.task_id ?? '',  // 背景任务：task_id 即为子 session ID
      parentSessionId,
      agent,
      contextStrategy: defaultStrategyFor(agent),
      label,
      status: 'running',
      background: args.background ?? false,
      terminalReconciled: false,
      createdAt: Date.now(),
    });

    return alias;
  }

  /**
   * 在 tool.execute.after 中调用，更新任务完成状态
   * 非背景任务：立即标 completed；背景任务：不更新（等 session.idle 事件）
   */
  updateAfterTask(parentSessionId: string, status: TaskStatus, sessionId?: string): void {
    this._currentParentSessionId = parentSessionId;
    // 找到该 parent 下最近创建的 running 任务
    let latest: JobRecord | undefined;
    for (const job of this.jobs.values()) {
      if (
        job.parentSessionId === parentSessionId &&
        job.status === 'running' &&
        (!latest || job.createdAt > latest.createdAt)
      ) {
        latest = job;
      }
    }
    if (latest) {
      // 背景任务：不标 completed，由 event hook 处理
      if (latest.background) {
        if (sessionId) latest.sessionId = sessionId;
        return;
      }
      latest.status = status;
      latest.terminalReconciled = true;
      if (sessionId) latest.sessionId = sessionId;
      this.finalize(latest);
      this.persistStats();
    }
  }

  /**
   * 根据子 session ID 更新任务状态（供 event hook 使用）
   * 当背景任务的 session 变为 idle 时调用
   */
  updateByChildSessionId(sessionId: string, status: TaskStatus): void {
    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId && job.background && job.status === 'running') {
        job.status = status;
        this.finalize(job);
        this.persistStats();
        return;
      }
    }
  }

  /**
   * 生成 Background Job Board 文本
   */
  getBoardText(parentSessionId?: string): string {
    const pid = parentSessionId || this._currentParentSessionId;
    const activeJobs: JobRecord[] = [];
    const reusableJobs: JobRecord[] = [];

    for (const job of this.jobs.values()) {
      if (job.parentSessionId !== pid) continue;
      if (job.status === 'running') {
        activeJobs.push(job);
      } else if (job.background && job.status === 'completed' && !job.terminalReconciled) {
        reusableJobs.push(job);
      }
    }

    // 完全空态：什么都不注入
    if (activeJobs.length === 0 && reusableJobs.length === 0) return '';

    // 只有可复用 session，无活跃任务：返回极简一行文本
    if (activeJobs.length === 0) {
      const abbrMap: Record<string, string> = {
        'co-explorer': 'co-exp',
        'co-oracle': 'co-ora',
        'co-fixer': 'co-fix',
        'co-planner': 'co-pln',
        'co-designer': 'co-des',
        'co-librarian': 'co-lib',
        'co-observer': 'co-obs',
        'co-council': 'co-cnl',
      };
      const abbreviate = (agent: string): string =>
        abbrMap[agent] ?? (agent.startsWith('co-rule-') ? 'co-rul' : agent);

      const maxShow = 8;
      const shown = reusableJobs.slice(0, maxShow);
      const extra = reusableJobs.length - maxShow;

      const parts = shown.map(j => `${j.sessionId}(${abbreviate(j.agent)})`);
      let text = '复用: ' + parts.join(' ');
      if (extra > 0) {
        text += ` …及 ${extra} 个`;
      }
      return text;
    }

    // 有活跃任务：保持现有完整格式
    const lines: string[] = [];
    lines.push('### Background Job Board');
    lines.push('SENTINEL: background-job-board-v2');
    lines.push('Do not poll running jobs. Wait for hook-driven completion, or use cancel_task only for explicit cancellation. Reconcile terminal jobs before final response.');
    lines.push('To reuse a completed session, use its Session ID from the table below as task_id (e.g. `ses_xxx`). Passing an alias instead is silently ignored — OpenCode creates a new session instead of reusing.');
    lines.push('Cancelled or errored sessions are not reusable.');
    lines.push('');

    if (activeJobs.length > 0) {
      lines.push('#### Active / Unreconciled');
      for (const j of activeJobs) {
        lines.push(`  - ${j.agent} / ${j.status} / ${j.sessionId || 'pending'} / alias=${j.alias}`);
      }
      lines.push('');
    }

    if (reusableJobs.length > 0) {
      lines.push('#### Reusable Sessions');
      lines.push('  Session ID                            | Agent        | Alias');
      lines.push('  ---------------------------------------|--------------|-------');
      for (const j of reusableJobs) {
        lines.push(`  \`${j.sessionId}\`  | ${j.agent}  | _${j.alias}_`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 标记任务已调和（不再显示在 Unreconciled 中）
   */
  reconcileJob(alias: string): void {
    const job = this.jobs.get(alias);
    if (job) {
      job.terminalReconciled = true;
    }
  }

  /**
   * 清理超时的背景任务（超过 timeoutMs 仍 running 的标为 errored）。
   *
   * 额外收集并返回这些超时任务的 sessionId 列表，供调用方真正执行 session.abort()。
   *
   * @returns 被标为 errored 的超时任务的 sessionId 列表（无 sessionId 的任务不包含）
   */
  cleanupStaleJobs(timeoutMs: number): string[] {
    const now = Date.now();
    const staleSessions: string[] = [];
    for (const job of this.jobs.values()) {
      if (job.background && job.status === 'running' && (now - job.createdAt) > timeoutMs) {
        job.status = 'errored';
        this.finalize(job);
        if (job.sessionId) staleSessions.push(job.sessionId);
      }
    }
    this.persistStats();
    return staleSessions;
  }

  /**
   * 检查任务是否可复用
   */
  isReusable(alias: string): boolean {
    const job = this.jobs.get(alias);
    return job?.status === 'completed' && job.terminalReconciled;
  }

  /** 获取所有正在运行的 agent 类型列表 */
  getRunningAgents(parentSessionId: string): string[] {
    const agents = new Set<string>();
    for (const job of this.jobs.values()) {
      if (job.parentSessionId === parentSessionId && job.status === 'running') {
        agents.add(job.agent);
      }
    }
    return Array.from(agents);
  }

  /** 获取父会话下所有运行中的任务数量 */
  getRunningCount(parentSessionId: string): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.parentSessionId === parentSessionId && job.status === 'running') {
        count++;
      }
    }
    return count;
  }

  /** 根据子 session ID 查找完整 JobRecord */
  getJobBySessionId(sessionId: string): JobRecord | undefined {
    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId) {
        return job;
      }
    }
    return undefined;
  }

  /**
   * 质量回送：把任务质量度量写回 JobRecord（负反馈闭环）
   * 由 event hook 在 session.idle 时调用
   */
  updateQuality(sessionId: string, quality: NonNullable<JobRecord['quality']>): void {
    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId) {
        job.quality = quality;
        this.finalize(job);
        this.persistStats();
        return;
      }
    }
  }

  /**
   * 终态收尾：确保 latencyMs 已记录（质量回送缺失时用 createdAt 差值补录）。
   * P2-2: 未判定时 quality.score 保持 undefined（语义≠质量最差），
   * 仅 assessQuality 实际执行过（updateQuality 传入）才携带 score。
   */
  private finalize(job: JobRecord): void {
    const latencyMs = Date.now() - job.createdAt;
    if (!job.quality) {
      job.quality = { latencyMs };
    } else if (job.quality.latencyMs === undefined) {
      job.quality.latencyMs = latencyMs;
    }
  }

  /** 收集全部终态任务为统计记录（按创建时间升序） */
  private collectStatsRecords(): StatsRecord[] {
    const jobs = Array.from(this.jobs.values())
      .filter((j) => j.status !== 'running')
      .sort((a, b) => a.createdAt - b.createdAt);
    return jobs.map((job) => ({
      agent: job.agent,
      strategy: job.contextStrategy ?? defaultStrategyFor(job.agent),
      status: job.status,
      ...(job.quality?.latencyMs !== undefined ? { latencyMs: job.quality.latencyMs } : {}),
      ...(job.quality?.tokens ? { tokens: job.quality.tokens } : {}),
    }));
  }

  /** 当前统计（内存态，按 (strategy, agent) 聚合；window 为滑动窗口条数） */
  getStats(window: number = DEFAULT_STATS_WINDOW): StatsBucket[] {
    return computeStats(this.collectStatsRecords(), window);
  }

  /** 把最近 window 条统计记录持久化到 STATS_FILE，供 CLI stats 子命令读取 */
  persistStats(window: number = DEFAULT_STATS_WINDOW): void {
    try {
      const recent = this.collectStatsRecords().slice(-Math.max(1, window));
      fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
      fs.writeFileSync(STATS_FILE, JSON.stringify(recent, null, 2), 'utf8');
    } catch {
      // 统计持久化失败不影响任务追踪主流程
    }
  }
  /** cancel_task 集成：根据别名或 sessionId 标记任务为已取消并 reconcile */
  markCancelled(taskId: string): void {
    let job = this.jobs.get(taskId);
    if (!job) {
      for (const j of this.jobs.values()) {
        if (j.sessionId === taskId) { job = j; break; }
      }
    }
    if (job) {
      job.status = 'cancelled';
      job.terminalReconciled = true;
      this.finalize(job);
      this.persistStats();
    }
  }

  /**
   * 关闭（中止）一个卡住/不必要的子代理后台任务。
   *
   * 按 taskId 定位任务：先按 alias 直接查 this.jobs，再按 sessionId 遍历匹配。
   * 只做状态同步（标记为 cancelled 并 finalize/persist），返回真正的 sessionId 供调用方
   * 执行 session.abort()——本方法保持无 IO 依赖，便于单测。
   *
   * @param taskId 子 session ID（ses_xxx）或任务 alias（如 coe-1）
   * @returns 找到任务时返回 { sessionId, job }；未找到返回 undefined
   */
  abortJob(taskId: string): { sessionId?: string; job: JobRecord } | undefined {
    let job = this.jobs.get(taskId);
    if (!job) {
      for (const j of this.jobs.values()) {
        if (j.sessionId === taskId) { job = j; break; }
      }
    }
    if (!job) return undefined;

    // 幂等守卫：已是终态的任务不再重复改写状态/统计（重复 abort 直接返回原状态）
    if (job.status !== 'running') {
      return { sessionId: job.sessionId || undefined, job };
    }

    job.status = 'cancelled';
    job.terminalReconciled = true;
    this.finalize(job);
    this.persistStats();

    return { sessionId: job.sessionId || undefined, job };
  }
}
