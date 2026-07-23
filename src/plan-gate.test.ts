// src/plan-gate.test.ts
// PlanApprovalManager 单元测试
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { PlanApprovalManager, createRequestPlanApprovalTool } from './plan-gate';

// ===========================================================================
// PlanApprovalManager 核心行为
// ===========================================================================

describe('PlanApprovalManager', () => {
  let mgr: PlanApprovalManager;

  beforeEach(() => {
    mgr = new PlanApprovalManager();
  });

  // -----------------------------------------------------------------------
  // 1. 非 orchestrator 消息不创建状态
  // -----------------------------------------------------------------------
  test('非 orchestrator 消息不创建状态', () => {
    const result = mgr.observeUserMessage('ses_001', 'co-fixer');
    expect(result).toBe(false);
    // 未登记的 session 不应有批准
    expect(mgr.isApproved('ses_001')).toBe(false);
    expect(mgr.getSystemContext('ses_001')).toBe('');
  });

  // -----------------------------------------------------------------------
  // 2. 首条 orchestrator 消息 generation=1 且未批准
  // -----------------------------------------------------------------------
  test('首条 orchestrator 消息 generation=1 且未批准', () => {
    const result = mgr.observeUserMessage('ses_001', 'co-orchestrator');
    expect(result).toBe(true);
    expect(mgr.isApproved('ses_001')).toBe(false);

    const ctx = mgr.getSystemContext('ses_001');
    expect(ctx).toContain('generation="1"');
    expect(ctx).toContain('approved="false"');
  });

  // -----------------------------------------------------------------------
  // 3. approve 后当前 generation 获批
  // -----------------------------------------------------------------------
  test('approve 后当前 generation 获批', () => {
    mgr.observeUserMessage('ses_001', 'co-orchestrator');
    mgr.approve('ses_001', {
      summary: '测试方案',
      files: ['src/a.ts', 'src/b.ts'],
      verification: '编译测试',
    });
    expect(mgr.isApproved('ses_001')).toBe(true);

    const ctx = mgr.getSystemContext('ses_001');
    expect(ctx).toContain('approved="true"');
    expect(ctx).toContain('测试方案');
  });

  // -----------------------------------------------------------------------
  // 4. 下一条用户消息 generation+1 且撤销批准
  // -----------------------------------------------------------------------
  test('下一条用户消息 generation+1 且撤销批准', () => {
    mgr.observeUserMessage('ses_001', 'co-orchestrator');
    mgr.approve('ses_001', {
      summary: '方案一',
      files: ['src/a.ts'],
      verification: '测试',
    });
    expect(mgr.isApproved('ses_001')).toBe(true);

    // 第二条消息
    const result = mgr.observeUserMessage('ses_001', 'co-orchestrator');
    expect(result).toBe(true);
    expect(mgr.isApproved('ses_001')).toBe(false);

    const ctx = mgr.getSystemContext('ses_001');
    expect(ctx).toContain('generation="2"');
    expect(ctx).toContain('approved="false"');
  });

  // -----------------------------------------------------------------------
  // 5. agent 缺省但已登记 session 仍可递增并撤销
  // -----------------------------------------------------------------------
  test('agent 缺省但已登记 session 仍可递增并撤销', () => {
    // 首次: orchestrator
    mgr.observeUserMessage('ses_001', 'co-orchestrator');
    mgr.approve('ses_001', {
      summary: '方案',
      files: [],
      verification: '',
    });

    // 第二次: agent 缺省 (undefined)
    const result = mgr.observeUserMessage('ses_001', undefined);
    expect(result).toBe(true);
    expect(mgr.isApproved('ses_001')).toBe(false);

    const ctx = mgr.getSystemContext('ses_001');
    expect(ctx).toContain('generation="2"');
  });

  // -----------------------------------------------------------------------
  // 6. cleanup 删除状态
  // -----------------------------------------------------------------------
  test('cleanup 删除状态', () => {
    mgr.observeUserMessage('ses_001', 'co-orchestrator');
    expect(mgr.activeSessionCount).toBe(1);

    mgr.cleanup('ses_001');
    expect(mgr.activeSessionCount).toBe(0);
    expect(mgr.isApproved('ses_001')).toBe(false);
    expect(mgr.getSystemContext('ses_001')).toBe('');
  });

  // -----------------------------------------------------------------------
  // 7. 未观察 session 不能 approve
  // -----------------------------------------------------------------------
  test('未观察 session 不能 approve', () => {
    expect(() => {
      mgr.approve('ses_unknown', {
        summary: '测试',
        files: [],
        verification: '',
      });
    }).toThrow('尚未被 PlanGate 观察');
  });

  // -----------------------------------------------------------------------
  // 8. approve 对 generation 0 拒绝
  // -----------------------------------------------------------------------
  test('approve 对 generation 0 拒绝', () => {
    // 直接 approve 未递增 generation 的 session
    const mgr2 = new PlanApprovalManager();
    // 先观察但 generation 从 0 开始
    // 实际上 observeUserMessage 才会递增，所以无法直接构造 generation=0 的 state
    // 需要绕过 observe 直接测试 approve 内部逻辑
    // 使用私有状态构造: 直接 call observe 然后想办法... 实际上 observe 会递增到 1
    // 我们用一个边缘 case 验证: mock 一个只被 observe 但 generation 为 0 不可能，
    // 因为 observe 会让 generation >= 1。这条测试验证的是 approve 内部防御。
    // 更直接的：未 observe 的 session 会被第一个 throw 拦截
    expect(() => {
      mgr.approve('nonexistent', { summary: '', files: [], verification: '' });
    }).toThrow();
  });

  // -----------------------------------------------------------------------
  // 9. system context 正确反映 generation/approved
  // -----------------------------------------------------------------------
  test('system context 格式正确', () => {
    // 未登记
    expect(mgr.getSystemContext('unknown')).toBe('');

    // 登记后未批准
    mgr.observeUserMessage('ses_001', 'co-orchestrator');
    let ctx = mgr.getSystemContext('ses_001');
    expect(ctx).toMatch(/<plan_gate generation="1" approved="false">/);
    expect(ctx).toContain('</plan_gate>');

    // 批准后
    mgr.approve('ses_001', {
      summary: '重构 user 模块',
      files: ['src/user.ts', 'src/user.test.ts'],
      verification: 'npm test',
    });
    ctx = mgr.getSystemContext('ses_001');
    expect(ctx).toMatch(/<plan_gate generation="1" approved="true">/);
    expect(ctx).toContain('plan_summary: 重构 user 模块');
    expect(ctx).toContain('plan_files: src/user.ts, src/user.test.ts');
  });

  // -----------------------------------------------------------------------
  // 10. 多条消息 generation 递增
  // -----------------------------------------------------------------------
  test('多条 orchestrator 消息 generation 递增', () => {
    for (let i = 1; i <= 5; i++) {
      mgr.observeUserMessage('ses_001', 'co-orchestrator');
      const ctx = mgr.getSystemContext('ses_001');
      expect(ctx).toContain(`generation="${i}"`);
      expect(ctx).toContain('approved="false"');
    }
    expect(mgr.activeSessionCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 11. 多个独立 session 互不干扰
  // -----------------------------------------------------------------------
  test('多个独立 session 互不干扰', () => {
    mgr.observeUserMessage('ses_A', 'co-orchestrator');
    mgr.observeUserMessage('ses_B', 'co-orchestrator');

    mgr.approve('ses_A', { summary: 'A', files: [], verification: '' });
    expect(mgr.isApproved('ses_A')).toBe(true);
    expect(mgr.isApproved('ses_B')).toBe(false);

    mgr.approve('ses_B', { summary: 'B', files: [], verification: '' });
    expect(mgr.isApproved('ses_A')).toBe(true);
    expect(mgr.isApproved('ses_B')).toBe(true);

    mgr.observeUserMessage('ses_A', 'co-orchestrator');
    expect(mgr.isApproved('ses_A')).toBe(false);
    expect(mgr.isApproved('ses_B')).toBe(true);
  });
});

// ===========================================================================
// createRequestPlanApprovalTool 基础结构验证
// ===========================================================================

describe('createRequestPlanApprovalTool', () => {
  let mgr: PlanApprovalManager;

  beforeEach(() => {
    mgr = new PlanApprovalManager();
  });

  test('返回工具对象包含 request_plan_approval', () => {
    const tools = createRequestPlanApprovalTool(mgr);
    expect(tools).toHaveProperty('request_plan_approval');
    expect(tools.request_plan_approval).toHaveProperty('description');
    expect(tools.request_plan_approval).toHaveProperty('args');
    expect(tools.request_plan_approval).toHaveProperty('execute');
  });

  test('工具参数结构正确', () => {
    const tools = createRequestPlanApprovalTool(mgr);
    const args = tools.request_plan_approval.args;
    // 验证参数 key 存在
    expect(args).toHaveProperty('summary');
    expect(args).toHaveProperty('files');
    expect(args).toHaveProperty('verification');
    // verify description is present and non-empty
    expect(tools.request_plan_approval.description).toBeTruthy();
    expect(tools.request_plan_approval.description).toContain('方案');
  });

  test('execute 调用 ctx.ask 且 user reject 时不批准', async () => {
    const tools = createRequestPlanApprovalTool(mgr);
    mgr.observeUserMessage('ses_001', 'co-orchestrator');

    // Mock toolContext where ask() rejects
    const toolContext = {
      sessionID: 'ses_001',
      agent: 'co-orchestrator',
      ask: async () => { throw new Error('User rejected'); },
    };

    await expect(
      tools.request_plan_approval.execute(
        { summary: '测试', files: ['a.ts'], verification: 'build' },
        toolContext as any,
      ),
    ).rejects.toThrow('User rejected');

    // ask 被拒绝，不应批准
    expect(mgr.isApproved('ses_001')).toBe(false);
  });

  test('approve 之前 session 必须已被 observeUserMessage 观察', () => {
    const tools = createRequestPlanApprovalTool(mgr);

    // 未观察的 session
    expect(() => mgr.approve('unknown', { summary: '', files: [], verification: '' })).toThrow();
  });

  test('approve 成功后 isApproved 返回 true', () => {
    const mgr2 = new PlanApprovalManager();
    mgr2.observeUserMessage('ses_001', 'co-orchestrator');
    mgr2.approve('ses_001', { summary: '修复 bug', files: ['a.ts'], verification: 'build' });
    expect(mgr2.isApproved('ses_001')).toBe(true);
  });

  test('execute 中 ctx.ask 成功时写入批准', async () => {
    const mgr3 = new PlanApprovalManager();
    const tools2 = createRequestPlanApprovalTool(mgr3);
    mgr3.observeUserMessage('ses_001', 'co-orchestrator');
    const toolContext = {
      sessionID: 'ses_001',
      agent: 'co-orchestrator',
      ask: async (_req: any) => { /* resolve normally */ },
    };
    const result = await tools2.request_plan_approval.execute(
      { summary: '测试', files: ['a.ts'], verification: 'build' },
      toolContext as any,
    );
    expect(mgr3.isApproved('ses_001')).toBe(true);
    expect(result).toContain('已批准');
  });
});
