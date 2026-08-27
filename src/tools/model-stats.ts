// src/tools/model-stats.ts
//
// T7: 模型级失败历史（前馈降级）。
// 用滑动窗口记录每个 model 每次尝试的结果（success / empty / timeout / error / quality-low），
// 提供查询、排序与 councillor 选择辅助：
//   - recordModelResult  回写一次尝试结果（窗口超出大小自动裁剪）
//   - getModelStats      查询单模型统计（无历史时返回全零，failureRate=0 / successRate=1）
//   - getSortedModels    按失败率升序返回全部有历史的模型
//   - orderCouncillorsByFailure  排序 councillor 条目（低失败率优先），
//     失败率 > highFailureRate 且样本 ≥ minSamples 的模型在存在替代时被软跳过
// 窗口大小与阈值均可配置（configureModelStats），测试可 resetModelStats 清空。

import type { FailureCategory } from '../task-manager/quality.js';

/** 每次尝试的结果分类：成功或某一类失败 */
export type ModelResultCategory = FailureCategory | 'success';

/** T7 可配置参数 */
export interface ModelStatsConfig {
  /** 滑动窗口大小：每个 model 保留最近 N 次尝试（默认 20） */
  windowSize: number;
  /** 高失败率阈值：失败率 > 该值视为高风险（默认 0.5，即 50%） */
  highFailureRate: number;
  /** 判定高风险所需的最小样本数（默认 5） */
  minSamples: number;
}

export const DEFAULT_MODEL_STATS_CONFIG: ModelStatsConfig = {
  windowSize: 20,
  highFailureRate: 0.5,
  minSamples: 5,
};

/** 单个 model 的统计快照 */
export interface ModelStats {
  model: string;
  total: number;
  successes: number;
  failures: number;
  empty: number;
  timeout: number;
  error: number;
  qualityLow: number;
  /** 失败率 = failures / total（无样本时为 0） */
  failureRate: number;
  /** 成功率 = successes / total（无样本时为 1，未知模型默认信任） */
  successRate: number;
}

let config: ModelStatsConfig = { ...DEFAULT_MODEL_STATS_CONFIG };

/** model -> 最近 N 次结果（队尾最新） */
const history = new Map<string, ModelResultCategory[]>();

// ----------------------------------------------------------------------------
// 配置与生命周期
// ----------------------------------------------------------------------------

/** 读取当前配置（返回副本，避免外部篡改） */
export function getModelStatsConfig(): ModelStatsConfig {
  return { ...config };
}

/** 部分更新配置（未提供的字段保持原值） */
export function configureModelStats(partial: Partial<ModelStatsConfig>): void {
  config = { ...config, ...partial };
}

/** 清空全部历史（测试与运行时重置用） */
export function resetModelStats(): void {
  history.clear();
}

// ----------------------------------------------------------------------------
// 记录与查询
// ----------------------------------------------------------------------------

/** 记录一次尝试结果到滑动窗口，超出窗口大小自动丢弃最旧记录 */
export function recordModelResult(model: string, category: ModelResultCategory): void {
  const window = history.get(model) ?? [];
  window.push(category);
  if (window.length > config.windowSize) {
    window.splice(0, window.length - config.windowSize);
  }
  history.set(model, window);
}

/** 查询单模型统计（无历史时返回全零快照） */
export function getModelStats(model: string): ModelStats {
  const window = history.get(model) ?? [];
  let successes = 0;
  let empty = 0;
  let timeout = 0;
  let error = 0;
  let qualityLow = 0;
  for (const c of window) {
    if (c === 'success') {
      successes += 1;
    } else if (c === 'empty') {
      empty += 1;
    } else if (c === 'timeout') {
      timeout += 1;
    } else if (c === 'error') {
      error += 1;
    } else {
      qualityLow += 1;
    }
  }
  const total = window.length;
  const failures = total - successes;
  return {
    model,
    total,
    successes,
    failures,
    empty,
    timeout,
    error,
    qualityLow,
    failureRate: total === 0 ? 0 : failures / total,
    successRate: total === 0 ? 1 : successes / total,
  };
}

/** 按失败率升序返回全部有历史记录的模型及其统计 */
export function getSortedModels(): Array<{ model: string; stats: ModelStats }> {
  return [...history.keys()]
    .map((model) => ({ model, stats: getModelStats(model) }))
    .sort((a, b) => a.stats.failureRate - b.stats.failureRate);
}

// ----------------------------------------------------------------------------
// councillor 选择辅助（前馈降级入口）
// ----------------------------------------------------------------------------

/**
 * 按失败率升序排序 councillor 条目（成功率高的优先），并做软剔除：
 * - 失败率 > highFailureRate 且样本 ≥ minSamples 的模型为高风险；
 * - 存在替代模型（剔除后仍有条目）时跳过高风险模型；
 * - 全部为高风险（无替代）时回退到完整列表，不硬剔除；
 * - 排序使用稳定 sort，同失败率保持原顺序。
 *
 * statsProvider 与 cfg 可注入以便测试，默认使用模块级存储与配置。
 */
export function orderCouncillorsByFailure<T extends { model: string }>(
  entries: Array<[string, T]>,
  statsProvider: (model: string) => ModelStats = getModelStats,
  cfg: ModelStatsConfig = config,
): Array<[string, T]> {
  const isHighRisk = ([, c]: [string, T]): boolean => {
    const s = statsProvider(c.model);
    return s.total >= cfg.minSamples && s.failureRate > cfg.highFailureRate;
  };

  const preferred = entries.filter((entry) => !isHighRisk(entry));
  // 无替代模型时回退全部（不硬剔除）
  const chosen = preferred.length > 0 ? preferred : [...entries];

  return chosen.sort(
    (a, b) => statsProvider(a[1].model).failureRate - statsProvider(b[1].model).failureRate,
  );
}
