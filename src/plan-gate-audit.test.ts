// src/plan-gate-audit.test.ts
// BoundedPlanGateAudit 单元测试
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { BoundedPlanGateAudit, type AuditEvent } from './plan-gate-audit';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ===========================================================================
// 辅助
// ===========================================================================

/** 生成临时日志路径 */
function tmpLogPath(): string {
  return path.join(
    os.tmpdir(),
    `plan-gate-audit-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

/** 清理临时文件 */
function cleanupLog(p: string): void {
  try { fs.unlinkSync(p); } catch {}
  try { fs.unlinkSync(p + '.tmp'); } catch {}
}

// ===========================================================================
// BoundedPlanGateAudit
// ===========================================================================

describe('BoundedPlanGateAudit', () => {
  let logPath: string;

  beforeEach(() => {
    logPath = tmpLogPath();
  });

  afterEach(() => {
    cleanupLog(logPath);
  });

  // -------------------------------------------------------------------------
  // 1. 空缓冲区初始状态
  // -------------------------------------------------------------------------
  test('空缓冲区初始状态', () => {
    const audit = new BoundedPlanGateAudit(logPath);
    // 文件尚不存在（构造函数只在文件存在时恢复）
    expect(fs.existsSync(logPath)).toBe(false);
    // 但实例可正常使用
    audit.record({ event: 'test', session: 'ses_001', generation: 1 });
    expect(fs.existsSync(logPath)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. record() 追加事件，flush() 写入文件
  // -------------------------------------------------------------------------
  test('record() 追加事件，flush() 写入文件', () => {
    const audit = new BoundedPlanGateAudit(logPath);
    audit.record({
      event: 'approved',
      session: 'ses_001',
      generation: 1,
      agent: 'co-orchestrator',
    });

    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(data.version).toBe(1);
    expect(data.events.length).toBe(1);
    expect(data.events[0].event).toBe('approved');
    expect(data.events[0].session).toBe('ses_001');
    expect(data.events[0].generation).toBe(1);
    expect(data.events[0].agent).toBe('co-orchestrator');
    expect(typeof data.events[0].at).toBe('string');
    expect(new Date(data.events[0].at).getTime()).not.toBeNaN();
  });

  // -------------------------------------------------------------------------
  // 3. 超过 50 条时自动裁剪，保留最近 50 条
  // -------------------------------------------------------------------------
  test('超过 50 条时自动裁剪，保留最近 50 条', () => {
    const audit = new BoundedPlanGateAudit(logPath);
    for (let i = 1; i <= 60; i++) {
      audit.record({ event: `e${i}`, session: 'ses_001', generation: i });
    }
    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(data.events.length).toBe(50);
    expect(data.events[0].event).toBe('e11');
    expect(data.events[49].event).toBe('e60');
  });

  // -------------------------------------------------------------------------
  // 4. 从已有文件恢复事件
  // -------------------------------------------------------------------------
  test('从已有文件恢复事件', () => {
    // 先写入一批事件
    {
      const audit = new BoundedPlanGateAudit(logPath);
      audit.record({ event: 'first', session: 'ses_001', generation: 1 });
      audit.record({ event: 'second', session: 'ses_001', generation: 2 });
    }

    // 新实例读取同一文件
    const audit2 = new BoundedPlanGateAudit(logPath);
    audit2.record({ event: 'third', session: 'ses_001', generation: 3 });

    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(data.events.length).toBe(3);
    expect(data.events[0].event).toBe('first');
    expect(data.events[1].event).toBe('second');
    expect(data.events[2].event).toBe('third');
  });

  // -------------------------------------------------------------------------
  // 5. 原子写：写入后文件格式正确，tmp 文件已清理
  // -------------------------------------------------------------------------
  test('原子写：文件格式正确，tmp 已清理', () => {
    const audit = new BoundedPlanGateAudit(logPath);
    audit.record({ event: 'alpha', session: 'ses_001', generation: 1 });

    // 主文件是合法 JSON
    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(data.events.length).toBe(1);

    // tmp 文件不应存在
    expect(fs.existsSync(logPath + '.tmp')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 6. flush() 写入失败时不抛异常
  // -------------------------------------------------------------------------
  test('flush() 写入失败时不抛异常', () => {
    // 使用一个路径，其父目录不可写入（模拟写入失败）
    const badPath = path.join(os.tmpdir(), 'nonexistent-dir-xyz-999', 'audit.json');
    const audit = new BoundedPlanGateAudit(badPath);
    // 不应抛异常
    expect(() => {
      audit.record({ event: 'test', session: 'ses_001', generation: 1 });
    }).not.toThrow();
    // 清理可能创建的文件
    cleanupLog(badPath);
    try { fs.rmdirSync(path.dirname(badPath)); } catch {}
  });

  // -------------------------------------------------------------------------
  // 7. 多事件顺序正确
  // -------------------------------------------------------------------------
  test('多事件顺序正确', () => {
    const audit = new BoundedPlanGateAudit(logPath);
    const events = [
      { event: 'alpha', session: 'ses_001', generation: 1 },
      { event: 'beta', session: 'ses_001', generation: 2 },
      { event: 'gamma', session: 'ses_001', generation: 3 },
    ];
    for (const e of events) {
      audit.record(e);
    }
    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(data.events[0].event).toBe('alpha');
    expect(data.events[1].event).toBe('beta');
    expect(data.events[2].event).toBe('gamma');
  });

  // -------------------------------------------------------------------------
  // 8. 文件不存在时构造函数正常初始化
  // -------------------------------------------------------------------------
  test('文件不存在时构造函数正常初始化', () => {
    const nonExistent = path.join(
      os.tmpdir(),
      `nonexistent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    // 确保文件不存在
    expect(fs.existsSync(nonExistent)).toBe(false);

    const audit = new BoundedPlanGateAudit(nonExistent);
    // 可以正常使用
    audit.record({ event: 'after-init', session: 'ses_001', generation: 1 });

    const data = JSON.parse(fs.readFileSync(nonExistent, 'utf-8'));
    expect(data.events.length).toBe(1);
    expect(data.events[0].event).toBe('after-init');

    cleanupLog(nonExistent);
  });

  // -------------------------------------------------------------------------
  // 9. 文件格式错误时正常初始化（空数组）
  // -------------------------------------------------------------------------
  test('文件格式错误时正常初始化', () => {
    // 写入无效 JSON
    fs.writeFileSync(logPath, 'not-json{broken', 'utf-8');

    const audit = new BoundedPlanGateAudit(logPath);
    // 应当正常使用
    audit.record({ event: 'recovery', session: 'ses_001', generation: 1 });

    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(data.events.length).toBe(1);
    expect(data.events[0].event).toBe('recovery');
  });

  // -------------------------------------------------------------------------
  // 10. 所有字段正确持久化
  // -------------------------------------------------------------------------
  test('所有字段正确持久化', () => {
    const audit = new BoundedPlanGateAudit(logPath);
    const now = Date.now();
    audit.record({
      event: 'task_denied',
      session: 'ses_abcdef1234567890',
      generation: 3,
      revoked: 2,
      agent: 'co-fixer',
      reason: 'unapproved',
      fileCount: 5,
      summaryLen: 42,
    });

    const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(data.events.length).toBe(1);
    const e = data.events[0];
    expect(e.event).toBe('task_denied');
    expect(e.session).toBe('ses_abcdef1234567890');
    expect(e.generation).toBe(3);
    expect(e.revoked).toBe(2);
    expect(e.agent).toBe('co-fixer');
    expect(e.reason).toBe('unapproved');
    expect(e.fileCount).toBe(5);
    expect(e.summaryLen).toBe(42);
    expect(typeof e.at).toBe('string');
  });

  // -------------------------------------------------------------------------
  // 11. 多次 flush 内部状态不受损
  // -------------------------------------------------------------------------
  test('多次 flush 内部状态不受损', () => {
    const audit = new BoundedPlanGateAudit(logPath);
    for (let i = 1; i <= 3; i++) {
      audit.record({ event: `e${i}`, session: 'ses_001', generation: i });
      // 手动验证每次写入后文件可读
      const data = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
      expect(data.events.length).toBe(i);
      expect(data.events[i - 1].event).toBe(`e${i}`);
    }
  });
});
