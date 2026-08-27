// src/context/truncate.test.ts — truncateByTokens 纯函数测试
// @ts-nocheck — Bun 测试在运行时执行，类型由 bun:test 全局提供

import { truncateByTokens } from './extractor';

describe('truncateByTokens', () => {
  test('空文本返回空串', () => {
    expect(truncateByTokens('', 100)).toBe('');
  });

  test('maxTokens <= 0 返回空串', () => {
    expect(truncateByTokens('hello world', 0)).toBe('');
    expect(truncateByTokens('hello world', -5)).toBe('');
  });

  test('未超预算的文本原样返回', () => {
    const text = 'const x = 1;';
    expect(truncateByTokens(text, 100)).toBe(text);
  });

  test('恰好等于预算的文本原样返回', () => {
    const text = 'abcdefgh'; // 8 字符 = 2 token × 4 字符
    expect(truncateByTokens(text, 2)).toBe(text);
  });

  test('超预算文本按 4 字符/token 截断并追加省略标记', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const result = truncateByTokens(text, 2); // 预算 2 token → 8 字符
    expect(result.startsWith('abcdefgh')).toBe(true);
    // 实现注入的省略标记明确说明截断原因（token 预算）
    expect(result).toContain('正文已按 token 预算截断');
    // 截断生效：换行前的正文部分仅保留预算内 8 字符（标记本身计入结果总长）
    expect(result.split('\n')[0]).toHaveLength(8);
  });

  test('P2-5 纯中文按 1 token/字符估算：恰好等于预算原样返回', () => {
    // '你好' = 2 字符 × 1 token = 2 token，不超预算
    expect(truncateByTokens('你好', 2)).toBe('你好');
  });

  test('P2-5 纯中文超预算按 1 token/字符截断', () => {
    const result = truncateByTokens('你好世界', 2); // 预算 2 token → 前 2 个中文字符
    expect(result.split('\n')[0]).toBe('你好');
    expect(result).toContain('正文已按 token 预算截断');
  });

  test('P2-5 中英混合：中文按 1 token/字符、英文按 4 字符/token 累计', () => {
    // 'abc' = 0.75 token，'你' 累计 1.75 ≤ 2，'好' 累计 2.75 > 2 → 截断于 'abc你'
    const result = truncateByTokens('abc你好def', 2);
    expect(result.split('\n')[0]).toBe('abc你');
    expect(result).toContain('正文已按 token 预算截断');
  });

  test('P2-5 中英混合未超预算时原样返回', () => {
    // 'abc'(0.75) + '你好'(2) + 'def'(0.75) = 3.5 token ≤ 4
    const text = 'abc你好def';
    expect(truncateByTokens(text, 4)).toBe(text);
  });
});
