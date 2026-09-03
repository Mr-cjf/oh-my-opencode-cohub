// src/orchestration/contract.test.ts
// TDD: ContractManager 的 extract / buildPrompt / summarize

import type { AgentContract } from './types';

// ---- 最小化 bun:test 全局声明 ----
// Bun 运行时在全局注入 describe/test/expect；项目未安装 @types/bun，
// 因此用局部声明替代整文件 @ts-nocheck，使其余代码仍受类型检查约束。
interface ExpectResult {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeNull(): void;
  notToBeNull(): void;
  readonly not: Omit<ExpectResult, 'not'>;
}
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
declare function expect(actual: unknown): ExpectResult;

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