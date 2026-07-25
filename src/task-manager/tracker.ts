import type { JobRecord, TaskStatus, TaskArgs } from './types';

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
      if (sessionId) latest.sessionId = sessionId;
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
      } else if (job.status === 'completed' && !job.terminalReconciled) {
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
   * 清理超时的背景任务（超过 timeoutMs 仍 running 的标为 errored）
   */
  cleanupStaleJobs(timeoutMs: number): void {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.background && job.status === 'running' && (now - job.createdAt) > timeoutMs) {
        job.status = 'errored';
      }
    }
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

  /** 根据子 session ID 查找 JobRecord */
  getJobBySessionId(sessionId: string): { alias: string; agent: string } | undefined {
    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId) {
        return { alias: job.alias, agent: job.agent };
      }
    }
    return undefined;
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
    }
  }
}
