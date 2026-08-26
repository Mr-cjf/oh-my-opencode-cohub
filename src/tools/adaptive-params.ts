// src/tools/adaptive-params.ts
//
// T8（P2-3）：参数自适应——按 (strategy, agent) 的历史成功率自寻最优 retries / timeout。
// 仿 model-stats.ts 的「模块级存储 + 可注入配置 + 纯函数」模式，便于单测与运行时重置。
//
// 调整策略（council.ts 取参处调用 getAdaptiveParams 查询生效参数）：
//   - 成功率 > highRate（80%）→ retries 降 1、timeout 降一档（节省资源）
//   - 成功率 < lowRate（50%） → retries 升 1、timeout 升一档（提升成功率）
//   - 成功率未知 / 样本不足（< minSamples）→ 使用默认值，不调整
// 参数限幅：retries ∈ [minRetries, maxRetries] = [1, 5]；timeout ∈ [minTimeoutMs, maxTimeoutMs] = [60s, 300s]
// 滞后机制：同一调整方向需连续 hysteresisSamples 次采样（默认 5）才生效一次，
//           生效后计数清零重新累计，防止成功率在阈值附近时参数来回振荡。

// ----------------------------------------------------------------------------
// 配置与类型
// ----------------------------------------------------------------------------

export interface AdaptiveParamsConfig {
  /** 成功率高于该值（0-1）视为优秀，可降低参数（默认 0.8） */
  highRate: number;
  /** 成功率低于该值（0-1）视为偏弱，需提高参数（默认 0.5） */
  lowRate: number;
  /** 判定所需最小样本数：样本不足时不调整、用默认值（默认 5） */
  minSamples: number;
  /** 滞后窗口：同一方向需连续采样 N 次才生效一次（默认 5） */
  hysteresisSamples: number;
  /** retries 下限（默认 1） */
  minRetries: number;
  /** retries 上限（默认 5） */
  maxRetries: number;
  /** timeout 下限 ms（默认 60_000 = 60s） */
  minTimeoutMs: number;
  /** timeout 上限 ms（默认 300_000 = 300s） */
  maxTimeoutMs: number;
  /** 自适应起点 retries（默认 3） */
  defaultRetries: number;
  /** 自适应起点 timeout ms（默认 180_000 = 180s） */
  defaultTimeoutMs: number;
  /** timeout 每档步长 ms（默认 30_000 = 30s） */
  timeoutStepMs: number;
  /** 滑动窗口大小：每个键保留最近 N 条样本（默认 20） */
  windowSize: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveParamsConfig = {
  highRate: 0.8,
  lowRate: 0.5,
  minSamples: 5,
  hysteresisSamples: 5,
  minRetries: 1,
  maxRetries: 5,
  minTimeoutMs: 60_000,
  maxTimeoutMs: 300_000,
  defaultRetries: 3,
  defaultTimeoutMs: 180_000,
  timeoutStepMs: 30_000,
  windowSize: 20,
};

/** 当前生效的自适应参数 */
export interface AdaptiveParams {
  retries: number;
  timeoutMs: number;
}

/** 调整方向：-1 降参 / 0 不变 / +1 升参 */
export type AdjustmentDirection = -1 | 0 | 1;

let config: AdaptiveParamsConfig = { ...DEFAULT_ADAPTIVE_CONFIG };

/** (strategy, agent) → 采样状态 */
interface AdaptiveSampleState {
  /** 滑动窗口内最近结果（队尾最新，true=成功） */
  recent: boolean[];
  /** 当前生效参数（初始为默认值） */
  current: AdaptiveParams;
  /** 上一次采样判定的方向 */
  lastDirection: AdjustmentDirection;
  /** 同方向连续采样次数 */
  streak: number;
}

const samples = new Map<string, AdaptiveSampleState>();

// ----------------------------------------------------------------------------
// 配置与生命周期
// ----------------------------------------------------------------------------

/** 读取当前配置（返回副本，避免外部篡改） */
export function getAdaptiveParamsConfig(): AdaptiveParamsConfig {
  return { ...config };
}

/** 部分更新配置（未提供的字段保持原值） */
export function configureAdaptiveParams(partial: Partial<AdaptiveParamsConfig>): void {
  config = { ...config, ...partial };
}

/** 清空全部采样历史（测试与运行时重置用） */
export function resetAdaptiveParams(): void {
  samples.clear();
}

// ----------------------------------------------------------------------------
// 纯函数：方向判定 / 限幅 / 单步调整
// ----------------------------------------------------------------------------

/**
 * 根据成功率与样本数判定调整方向（纯函数）：
 * - 样本不足 minSamples → 0（未知，不调整，用默认值）
 * - 成功率 > highRate → -1（降参）
 * - 成功率 < lowRate → +1（升参）
 * - 中间区间（含恰等于阈值）→ 0（不调整，避免边界抖动）
 */
export function evaluateAdjustment(
  successRate: number,
  sampleCount: number,
  cfg: AdaptiveParamsConfig = config,
): AdjustmentDirection {
  if (sampleCount < cfg.minSamples) return 0;
  if (successRate > cfg.highRate) return -1;
  if (successRate < cfg.lowRate) return 1;
  return 0;
}

/** 参数限幅（纯函数）：retries ∈ [minRetries, maxRetries]，timeout ∈ [minTimeoutMs, maxTimeoutMs] */
export function clampAdaptiveParams(
  params: AdaptiveParams,
  cfg: AdaptiveParamsConfig = config,
): AdaptiveParams {
  return {
    retries: Math.min(cfg.maxRetries, Math.max(cfg.minRetries, Math.round(params.retries))),
    timeoutMs: Math.min(cfg.maxTimeoutMs, Math.max(cfg.minTimeoutMs, Math.round(params.timeoutMs))),
  };
}

/** 按方向调整一档参数（纯函数）：-1 降、+1 升、0 不变，调整后限幅 */
export function adjustAdaptiveParams(
  current: AdaptiveParams,
  direction: AdjustmentDirection,
  cfg: AdaptiveParamsConfig = config,
): AdaptiveParams {
  if (direction === 0) return clampAdaptiveParams(current, cfg);
  return clampAdaptiveParams(
    {
      retries: current.retries + direction,
      timeoutMs: current.timeoutMs + direction * cfg.timeoutStepMs,
    },
    cfg,
  );
}

// ----------------------------------------------------------------------------
// 采样记录与生效参数查询（滞后状态机）
// ----------------------------------------------------------------------------

/**
 * 记录一次采样结果并推进滞后状态机：
 * - key 形如 "strategy\u0000agent"（与 tracker computeStats 的键一致）
 * - 样本不足 minSamples 时仅积累样本、不推进滞后状态（参数保持默认）
 * - 样本足够后按滑动窗口成功率判定方向；方向与上次相同则 streak+1，否则重置为 1
 * - streak 达到 hysteresisSamples 时生效一次调整，随后清零重新累计
 */
export function recordAdaptiveSample(
  key: string,
  success: boolean,
  cfg: AdaptiveParamsConfig = config,
): void {
  let st = samples.get(key);
  if (!st) {
    st = {
      recent: [],
      current: { retries: cfg.defaultRetries, timeoutMs: cfg.defaultTimeoutMs },
      lastDirection: 0,
      streak: 0,
    };
    samples.set(key, st);
  }
  st.recent.push(success);
  if (st.recent.length > cfg.windowSize) {
    st.recent.splice(0, st.recent.length - cfg.windowSize);
  }

  const total = st.recent.length;
  // 样本不足：仅积累样本，不推进滞后状态（参数保持默认，避免污染方向计数）
  if (total < cfg.minSamples) return;

  const successes = st.recent.filter(Boolean).length;
  const direction = evaluateAdjustment(successes / total, total, cfg);

  if (direction === st.lastDirection) {
    st.streak += 1;
  } else {
    st.lastDirection = direction;
    st.streak = 1;
  }
  if (st.streak >= cfg.hysteresisSamples) {
    st.current = adjustAdaptiveParams(st.current, direction, cfg);
    st.streak = 0;
  }
}

/** 查询当前生效的自适应参数（无历史时返回默认值） */
export function getAdaptiveParams(key: string, cfg: AdaptiveParamsConfig = config): AdaptiveParams {
  const st = samples.get(key);
  if (!st) return { retries: cfg.defaultRetries, timeoutMs: cfg.defaultTimeoutMs };
  return { ...st.current };
}
