// src/task-manager/quality.ts — 任务质量判定器（P0-1 负反馈闭环）
// 轻量启发式：结果非空 + exit 正常 + 无错误关键词 + decisions 捕获数 ≥1 为及格线。
// 保守策略：quality.enabled 默认开启，但低分只标记（写回 JobRecord.quality），
// 不改变现有任务成败判定（status 仍由 tracker 现有逻辑决定）。
// P1-3: hasErrorKeywords 增加否定短语感知与整词边界/上下文检查，
// 消除否定式（"No errors found"）、代码片段（console.error）等误报。

export type FailureCategory = 'timeout' | 'empty' | 'error' | 'quality-low';

/** 质量回送配置 */
export interface QualityConfig {
  /** 是否启用质量回送（默认开启；低分仅标记，不改变任务成败判定） */
  enabled: boolean;
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  enabled: true,
};

/** 判定器输入（来自 captureResult 提取的数据） */
export interface QualityInput {
  output: string;                    // 子代理最终关键输出（可为空）
  exitCode?: number;                 // 退出码（undefined 视为正常）
  decisions: number;                 // 捕获到的决策数
  timedOut?: boolean;                // 是否超时
  latencyMs?: number;                // 任务耗时
  tokens?: { input: number; output: number };
}

/** 判定结果 */
export interface QualityResult {
  score: number;                     // 0-1 连续评分（四项各 0.25）
  passed: boolean;                   // 及格线：四项全部满足（score === 1）
  failureCategory?: FailureCategory; // 未及格时的失败分类
  latencyMs?: number;
  tokens?: { input: number; output: number };
}

/** 错误关键词（英文大小写不敏感匹配，中文直接包含） */
const ERROR_KEYWORDS = [
  'error', 'failed', 'failure', 'exception', 'traceback', 'unable to',
  '失败', '错误', '异常', '无法完成', '未能',
];

/** 需要整词边界 + 上下文检查的高频英文关键词（避免复数/代码片段误报） */
const BOUNDARY_KEYWORDS = new Set(['error', 'failed', 'failure', 'exception']);

/**
 * 否定短语（P1-3 / P2-a）：命中位置前 N 字符内（含关键词自身）出现任一完整短语则视为被否定。
 * P2-a: 收敛为完整否定短语（no errors found / without any error / 未发现错误 / 无错误 等），
 * 移除裸泛化词（"没有""未发现"等）——否则 "没有修复错误""未解决错误" 等真实负面表述会被误剥。
 */
const NEGATION_PHRASES = [
  'no error', 'no errors', 'no failure', 'no failures', 'no exception', 'no exceptions',
  'without error', 'without errors', 'without any error', 'without any errors',
  'without failure', 'without failures', 'without exception', 'without exceptions',
  'without any failure', 'without any failures', 'without any exception', 'without any exceptions',
  'with no error', 'with no errors', 'with no failure', 'with no failures',
  'not an error', 'not a failure', 'is not an error', 'never failed', 'never fails',
  'did not fail', 'does not fail', 'not failed',
  '无错误', '没有错误', '未失败', '没有失败', '未发现错误', '未出现错误', '未发生错误',
  '不存在错误', '无异常', '没有异常', '未发现异常', '未出现异常',
  '没有发现错误', '没有发现任何错误', '未发现任何错误', '无任何错误',
  '未出现任何错误', '未发生任何错误', '不存在任何错误',
  '没有发现异常', '未发现任何异常', '无任何异常',
  '未遇到错误', '未产生错误', '未遇到异常', '未产生异常',
];

/** 否定短语检查窗口：关键词前 N 字符（P2-a: 16 以覆盖 "without any error" 的 13 字符前导等扩展否定式） */
const NEGATION_WINDOW = 16;

/** 命中位置是否被前文否定短语覆盖 */
function isNegated(lower: string, hitStart: number, hitLength: number): boolean {
  const windowStart = Math.max(0, hitStart - NEGATION_WINDOW);
  const window = lower.slice(windowStart, hitStart + hitLength);
  return NEGATION_PHRASES.some((phrase) => window.includes(phrase));
}

/**
 * 输出文本是否命中错误关键词（P1-3 修复）：
 * - 高频英文词（error/failed/failure/exception）要求整词边界匹配，
 *   排除成员访问（obj.error）与函数调用（new Error(）形式的代码片段；
 * - 否定短语出现在关键词前 N 字符内则跳过该次命中；
 * - 中文与低频英文关键词保留子串匹配，同样受否定窗口保护。
 */
export function hasErrorKeywords(text: string): boolean {
  const lower = text.toLowerCase();

  for (const kw of BOUNDARY_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const before = m.index > 0 ? lower[m.index - 1] : '';
      const after = lower[m.index + kw.length] ?? '';
      // 代码片段：console.error / obj.failed（成员访问）与 new Error(（构造调用）
      if (before === '.' || after === '(') continue;
      if (isNegated(lower, m.index, kw.length)) continue;
      return true;
    }
  }

  for (const kw of ERROR_KEYWORDS) {
    if (BOUNDARY_KEYWORDS.has(kw)) continue;
    let idx = lower.indexOf(kw);
    while (idx !== -1) {
      if (!isNegated(lower, idx, kw.length)) return true;
      idx = lower.indexOf(kw, idx + kw.length);
    }
  }

  return false;
}

/**
 * 质量判定（纯函数）：
 * - output 非空 +0.25
 * - exit 正常（undefined 或 0）+0.25
 * - 无错误关键词 +0.25
 * - decisions ≥ 1 +0.25
 * - 空输出视为无成果，score 直接归零（最低分，与 category 'empty' 呼应）
 * 及格线 = 四项全过（score 1.0）；低于 1.0 仅标记 failureCategory，不判任务失败。
 */
export function assessQuality(input: QualityInput): QualityResult {
  const outputOk = input.output.trim().length > 0;
  const exitOk = input.exitCode === undefined || input.exitCode === 0;
  const keywordOk = !hasErrorKeywords(input.output);
  const decisionsOk = input.decisions >= 1;
  const timedOut = input.timedOut === true;

  let score = 0;
  if (outputOk) score += 0.25;
  if (exitOk && !timedOut) score += 0.25;
  if (keywordOk && !timedOut) score += 0.25;
  if (decisionsOk && !timedOut) score += 0.25;
  // 空输出 = 无成果，score 归零（最低分），避免其他三项给出虚高分数
  if (!outputOk) score = 0;

  const passed = !timedOut && outputOk && exitOk && keywordOk && decisionsOk;

  let failureCategory: FailureCategory | undefined;
  if (!passed) {
    if (timedOut) failureCategory = 'timeout';
    else if (!outputOk) failureCategory = 'empty';
    else if (!exitOk || !keywordOk) failureCategory = 'error';
    else failureCategory = 'quality-low';
  }

  return {
    score,
    passed,
    ...(failureCategory ? { failureCategory } : {}),
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    ...(input.tokens ? { tokens: input.tokens } : {}),
  };
}

/** 是否启用质量回送（配置开关，默认开启） */
export function isQualityEnabled(config?: Partial<QualityConfig> | null): boolean {
  return config?.enabled ?? DEFAULT_QUALITY_CONFIG.enabled;
}
