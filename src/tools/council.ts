// src/tools/council.ts
//
// Multi-LLM council session tool for oh-my-opencode-cohub.
// Mirrors oh-my-opencode-slim's council implementation with cohub-specific
// agent naming and simplified depth tracking.

import { tool } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import type { createOpencodeClient } from '@opencode-ai/sdk';
import type { TextPart, ReasoningPart } from '@opencode-ai/sdk';
import { appendLog } from '../utils/log.js';
import { assessQuality } from '../task-manager/quality.js';
import type { FailureCategory } from '../task-manager/quality.js';
import { orderCouncillorsByFailure, recordModelResult } from './model-stats.js';
import {
  DEFAULT_ADAPTIVE_CONFIG,
  getAdaptiveParams,
  recordAdaptiveSample,
} from './adaptive-params.js';

// zod access via tool.schema (same pattern as slim)
const z = tool.schema;

// ============================================================================
// Type Definitions
// ============================================================================

export interface CouncillorConfig {
  /** "provider/model" */
  model: string;
  /** "max" | "high" | "medium" | "low" */
  variant?: string;
  /** Optional per-councillor prompt prefix */
  prompt?: string;
}

export interface CouncilPreset {
  [councillorName: string]: CouncillorConfig;
}

export interface CouncilConfig {
  /** Preset map (e.g. { default: { expert1: {...}, expert2: {...} } }) */
  presets: Record<string, CouncilPreset>;
  /** Per-councillor timeout in ms (default: 180000) */
  timeout?: number;
  /** Default preset name (default: "default") */
  default_preset?: string;
  /** Execution mode (default: "parallel") */
  councillor_execution_mode?: 'parallel' | 'serial';
  /** Retry budget for empty responses (default: 3) */
  councillor_retries?: number;
  /** Consensus agreement threshold 0-1 for convergence (default: 0.6) */
  consensus_threshold?: number;
  /** Hard cap on serial rounds (default: 2) */
  max_rounds?: number;
  /** Global retry budget shared by all councillors (default: 6) */
  max_total_retries?: number;
  /** Global elapsed budget for a whole council run in ms (default: 3 * timeout) */
  max_elapsed_ms?: number;
}

/** Internal councillor result shape */
interface CouncillorResult {
  name: string;
  model: string;
  status: string;
  result?: string;
  error?: string;
  /** Optional structured summary used for consensus detection */
  summary?: CouncillorSummary;
}

/** Structured summary extracted from a councillor response (T3) */
export interface CouncillorSummary {
  conclusions: string[];
  entities: string[];
}

/** Consensus detection input */
export interface ConsensusInput {
  name: string;
  summary: CouncillorSummary;
}

/** Consensus detection result */
export interface ConsensusResult {
  consensus: boolean;
  agreementScores: Record<string, number>;
  averageAgreement: number;
}

/** Retry decision outcome (T2 decision table) */
export type RetryAction = 'retry' | 'needs-human' | 'give-up' | 'budget-exhausted';

/** Per-category retry limits (empty keeps the legacy councillor_retries default) */
export const RETRY_LIMITS: Record<FailureCategory, number> = {
  empty: 3,
  timeout: 1,
  error: 0,
  'quality-low': 1,
};

// ============================================================================
// Helpers
// ============================================================================

class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationTimeoutError';
  }
}

/** Check if a Part has a text property (text or reasoning types). */
function isTextPart(part: { type: string; text?: string }): part is TextPart | ReasoningPart {
  return (part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string';
}

/**
 * Extract the last segment of a model reference.
 * e.g. "openai/gpt-4" → "gpt-4"
 */
function shortModelLabel(model: string): string {
  return model.split('/').pop() ?? model;
}

/**
 * Parse "provider/model" reference.
 * Returns null if format is invalid.
 */
function parseModelReference(model: string): { providerID: string; modelID: string } | null {
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= model.length - 1) return null;
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  };
}

/**
 * Abort a session, swallowing errors.
 */
async function abortSession(
  client: ReturnType<typeof createOpencodeClient>,
  sessionId: string,
): Promise<void> {
  try {
    await client.session.abort({ path: { id: sessionId } });
  } catch (err) {
    appendLog('abortSession', '中止会话失败', err);
  }
}

/**
 * Prompt a session with a timeout.
 * If the timeout fires, the session is aborted automatically.
 */
async function promptWithTimeout(
  client: ReturnType<typeof createOpencodeClient>,
  path: { id: string },
  body: {
    model: { providerID: string; modelID: string };
    agent?: string;
    noReply?: boolean;
    system?: string;
    tools?: Record<string, boolean>;
    variant?: string;
    parts: Array<{ type: 'text'; text: string }>;
  },
  timeoutMs: number,
  directory?: string,
): Promise<void> {
  const sessionId = path.id;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const promptPromise = client.session.prompt({
      path,
      body,
      query: directory ? { directory } : undefined,
    });
    // Suppress unhandled rejection — Promise.race handles errors
    promptPromise.catch(() => {});

    const racers: Array<Promise<unknown>> = [promptPromise];
    if (timeoutMs > 0) {
      racers.push(
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new OperationTimeoutError(`[oh-my-opencode-cohub] Prompt timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      );
    }

    await Promise.race(racers);
  } catch (error) {
    if (error instanceof OperationTimeoutError) {
      await abortSession(client, sessionId);
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Extract the combined assistant response text from a session's message
 * history.
 */
async function extractSessionResult(
  client: ReturnType<typeof createOpencodeClient>,
  sessionId: string,
  options?: { includeReasoning?: boolean; lastTextOnly?: boolean },
): Promise<{ text: string; empty: boolean }> {
  const includeReasoning = options?.includeReasoning ?? true;
  const lastTextOnly = options?.lastTextOnly === true;
  const messagesResult = await client.session.messages({
    path: { id: sessionId },
  });
  const messages = messagesResult.data ?? [];

  const assistantMessages = messages.filter(
    (m: { info?: { role?: string } }) => m.info?.role === 'assistant',
  );

  const extractedContent: string[] = [];
  for (const message of assistantMessages) {
    for (const part of message.parts ?? []) {
      if (!isTextPart(part)) continue;
      const allowed = includeReasoning || part.type === 'text';
      if (allowed && part.text) {
        extractedContent.push(part.text);
      }
    }
  }

  const texts = extractedContent.filter((t) => t.length > 0);
  // P1-3: lastTextOnly 只取最后一条 text part（排除 reasoning），供质量判定
  const text = lastTextOnly ? (texts.length > 0 ? texts[texts.length - 1] : '') : texts.join('\n\n');
  return { text, empty: text.length === 0 };
}

/**
 * Merge the user prompt with the optional councillor-specific prompt prefix.
 */
function formatCouncillorPrompt(userPrompt: string, councillorPrompt?: string): string {
  if (!councillorPrompt) return userPrompt;
  return `${councillorPrompt}\n\n---\n\n${userPrompt}`;
}

/**
 * Format all councillor results into a single structured text block that the
 * council agent can synthesize.
 */
function formatCouncillorResults(
  originalPrompt: string,
  councillorResults: CouncillorResult[],
): string {
  const completedWithResults = councillorResults.filter(
    (cr) => cr.status === 'completed' && cr.result,
  );

  const councillorSection = completedWithResults
    .map((cr) => {
      const shortModel = shortModelLabel(cr.model);
      return `**${cr.name}** (${shortModel}):\n${cr.result}`;
    })
    .join('\n\n');

  const failedEntries = councillorResults.filter((cr) => cr.status !== 'completed');
  const failedSection = failedEntries
    .map((cr) => `**${cr.name}**: ${cr.status} — ${cr.error ?? 'Unknown'}`)
    .join('\n');

  // All failed
  if (completedWithResults.length === 0) {
    const errorDetails = councillorResults
      .map(
        (cr) =>
          `**${cr.name}** (${shortModelLabel(cr.model)}): ${cr.status} — ${cr.error ?? 'Unknown'}`,
      )
      .join('\n');
    return [
      '---',
      '',
      '**Original Prompt**:',
      originalPrompt,
      '',
      '---',
      '',
      '**Councillor Responses**:',
      'All councillors failed to produce output:',
      errorDetails,
      '',
      'Please generate a response based on the original prompt alone.',
    ].join('\n');
  }

  // Some or all succeeded
  const parts: string[] = [
    '---',
    '',
    '**Original Prompt**:',
    originalPrompt,
    '',
    '---',
    '',
    '**Councillor Responses**:',
    councillorSection,
  ];

  if (failedSection) {
    parts.push('', '---', '', '**Failed/Timed-out Councillors**:', failedSection);
  }

  parts.push(
    '',
    '---',
    '',
    'You MUST follow the Synthesis Process steps before producing output: ' +
      'review each councillor response individually, then produce the required output ' +
      'with a synthesized Council Response, per-councillor details using their exact names, ' +
      'and a Council Summary with consensus confidence rating (unanimous, majority, or split).',
  );

  return parts.join('\n');
}

/**
 * P1-4: 构建 serial 模式第二轮起的协商 prompt —— 将上一轮其他成员的意见
 * 注入，要求当前 councillor 回应并修正或坚持立场，驱动收敛。
 */
function buildDeliberationPrompt(
  originalPrompt: string,
  previousRound: CouncillorResult[],
  currentName: string,
): string {
  const others = previousRound
    .filter((cr) => cr.status === 'completed' && cr.result && cr.name !== currentName)
    .map((cr) => `**${cr.name}** (${shortModelLabel(cr.model)}):\n${cr.result}`)
    .join('\n\n');
  if (!others) return originalPrompt;
  return [
    originalPrompt,
    '',
    '---',
    '',
    '以下是其他成员第一轮意见，请回应并修正或坚持你的立场：',
    '',
    others,
  ].join('\n');
}

/**
 * Build a human-readable model composition string.
 * e.g. "expert1: gpt-4, expert2: claude-3"
 */
function formatModelComposition(councillorResults: CouncillorResult[]): string {
  return councillorResults
    .map((cr) => `${cr.name}: ${shortModelLabel(cr.model)}`)
    .join(', ');
}

/**
 * T8: 自适应参数表的 (strategy, agent) 键。
 * strategy 取 councillor 的 variant 档位（未配置时为 "default"），agent 取模型引用；
 * 与 tracker computeStats 的 (strategy, agent) 聚合维度对齐。
 */
function adaptiveKey(config: CouncillorConfig): string {
  return `${config.variant ?? 'default'}\u0000${config.model}`;
}

// ----------------------------------------------------------------------------
// T2/T3/T4: failure classification, retry decision table, consensus detection
// ----------------------------------------------------------------------------

/** Map an error message to a failure category. */
export function classifyFailure(message: string): FailureCategory {
  if (message.includes('Empty response from provider')) return 'empty';
  if (message.includes('timed out') || message.includes('OperationTimeoutError')) return 'timeout';
  return 'error';
}

const CONCLUSION_MARKERS = [
  '综上', '结论', '因此', '总之', '建议', '推荐', '我认为', '最终', '关键结论',
  'conclusion', 'therefore', 'in summary', 'in conclusion', 'recommend', 'suggest', 'overall',
];

const ENTITY_MARKERS = [
  '决策', '决定', '方案', '采用', '选择', '关键', '实体', '要点', '关键决策',
  'decision', 'entity', 'key point', 'option', 'recommendation', 'key entity',
];

/**
 * Heuristically extract a structured summary (conclusion sentences + key
 * entity/decision sentences) from a councillor response text.
 */
export function extractCouncillorSummary(text: string): CouncillorSummary {
  const sentences = text
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const conclusions = sentences.filter((s) =>
    CONCLUSION_MARKERS.some((m) => s.toLowerCase().includes(m)),
  );
  const entities = sentences.filter((s) =>
    ENTITY_MARKERS.some((m) => s.toLowerCase().includes(m)),
  );

  return {
    conclusions:
      conclusions.length > 0 ? conclusions : sentences.length > 0 ? [sentences[sentences.length - 1]] : [],
    entities,
  };
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'were', 'be', 'been', 'this', 'that', 'it', 'as', 'at', 'by', 'from', '我们',
  '的', '了', '是', '在', '和', '与', '及', '或', '一个', '这个', '进行', '以及',
  // P1-1: 模板词剥离，避免"结论：采用X方案"高度模板化导致的共识假阳性
  '结论', '综上', '总之', '因此', '建议', '推荐', '最终', '我认为', '关键', '要点',
  '采用', '方案', '决策', '决定', '选择', '实体',
  'conclusion', 'therefore', 'summary', 'recommend', 'suggest', 'overall',
  'decision', 'option', 'recommendation', 'key', 'point', 'entity', 'error',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Jaccard overlap between two token sets. */
function jaccard(x: string[], y: string[]): number {
  if (x.length === 0 || y.length === 0) return 0;
  const xs = new Set(x);
  const ys = new Set(y);
  const inter = [...xs].filter((t) => ys.has(t)).length;
  const union = new Set([...xs, ...ys]).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Pairwise agreement between two summaries: 0.5 * conclusion overlap
 * + 0.5 * entity overlap (Jaccard on tokens).
 */
export function pairwiseAgreement(a: CouncillorSummary, b: CouncillorSummary): number {
  const aConcl = tokenize(a.conclusions.join(' '));
  const bConcl = tokenize(b.conclusions.join(' '));
  const aEnt = tokenize(a.entities.join(' '));
  const bEnt = tokenize(b.entities.join(' '));
  return 0.5 * jaccard(aConcl, bConcl) + 0.5 * jaccard(aEnt, bEnt);
}

/**
 * Compute consensus across councillor summaries.
 * Converged when >= ceil(2n/3) councillors have an average pairwise
 * agreement at or above the threshold.
 */
export function computeConsensus(inputs: ConsensusInput[], threshold: number): ConsensusResult {
  const n = inputs.length;
  if (n === 0) return { consensus: false, agreementScores: {}, averageAgreement: 0 };
  if (n === 1) {
    return { consensus: true, agreementScores: { [inputs[0].name]: 1 }, averageAgreement: 1 };
  }

  const agreementScores: Record<string, number> = {};
  for (const a of inputs) {
    let sum = 0;
    for (const b of inputs) {
      if (a.name === b.name) continue;
      sum += pairwiseAgreement(a.summary, b.summary);
    }
    agreementScores[a.name] = sum / (n - 1);
  }

  const values = Object.values(agreementScores);
  const averageAgreement = values.reduce((acc, v) => acc + v, 0) / values.length;
  const agreeing = values.filter((v) => v >= threshold).length;
  const required = Math.ceil((2 * n) / 3);
  return { consensus: agreeing >= required, agreementScores, averageAgreement };
}

/**
 * T2 retry decision table.
 * - consecutiveStreak >= 2 of the same category -> needs-human
 * - per-category retry limit reached            -> give-up
 * - shared budget exhausted                     -> budget-exhausted
 * - otherwise                                   -> retry
 */
export function decideRetryAction(
  category: FailureCategory,
  consecutiveStreak: number,
  categoryRetriesUsed: number,
  budgetAvailable: boolean,
  categoryLimit: number = RETRY_LIMITS[category],
): RetryAction {
  if (!budgetAvailable) return 'budget-exhausted';
  if (consecutiveStreak >= 2) return 'needs-human';
  if (categoryRetriesUsed >= categoryLimit) return 'give-up';
  return 'retry';
}

const VARIANT_ORDER = ['max', 'high', 'medium', 'low'] as const;

/** Downgrade a variant one step ("max" -> "high" -> "medium" -> "low" -> undefined). */
export function downgradeVariant(variant?: string): string | undefined {
  if (!variant) return undefined;
  const idx = VARIANT_ORDER.indexOf(variant as 'max' | 'high' | 'medium' | 'low');
  if (idx < 0 || idx >= VARIANT_ORDER.length - 1) return undefined;
  return VARIANT_ORDER[idx + 1];
}

/** Append retry guidance to the prompt based on the failure category. */
export function appendRetryContext(prompt: string, category: FailureCategory): string {
  if (category === 'timeout') {
    return `${prompt}\n\n[retry] 上次尝试超时。请精炼作答：先给出结论与关键决策，避免冗长过程。`;
  }
  if (category === 'quality-low') {
    return `${prompt}\n\n[retry] 上次回答缺少明确的结论与关键实体/决策。请以"结论：..."开头，并列出关键决策/实体要点。`;
  }
  return prompt;
}

/**
 * Shared retry budget (T4): a total retry counter plus an elapsed-time cap.
 * Both runCouncillorWithRetry retries and serial extra rounds draw from it.
 */
export class RetryBudget {
  retriesLeft: number;
  readonly maxElapsedMs: number;
  readonly startedAt: number;

  constructor(maxTotalRetries: number, maxElapsedMs: number, startedAt: number = Date.now()) {
    this.retriesLeft = Math.max(0, maxTotalRetries);
    this.maxElapsedMs = maxElapsedMs;
    this.startedAt = startedAt;
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  expired(): boolean {
    return this.elapsedMs() >= this.maxElapsedMs;
  }

  /** Consume one retry slot; returns false when exhausted or expired. */
  consumeRetry(): boolean {
    if (this.retriesLeft <= 0 || this.expired()) return false;
    this.retriesLeft -= 1;
    return true;
  }
}

// ============================================================================
// CouncilManager
// ============================================================================

export class CouncilManager {
  private client: ReturnType<typeof createOpencodeClient>;
  private directory: string;
  private config: CouncilConfig;

  constructor(
    client: ReturnType<typeof createOpencodeClient>,
    directory: string,
    config: CouncilConfig,
  ) {
    this.client = client;
    this.directory = directory;
    this.config = config;
  }

  /**
   * Run a full council session.
   * Resolves a preset, runs all councillors, and returns formatted results.
   */
  async runCouncil(
    prompt: string,
    presetName?: string,
    parentSessionId?: string,
  ): Promise<{
    success: boolean;
    result?: string;
    error?: string;
    councillorResults: CouncillorResult[];
    consensus?: boolean;
    agreement?: number;
  }> {
    // ---- resolve preset ----
    const resolvedPreset = presetName ?? this.config.default_preset ?? 'default';
    const preset = this.config.presets[resolvedPreset];

    if (!preset) {
      const available = Object.keys(this.config.presets).join(', ');
      return {
        success: false,
        error: `Preset "${resolvedPreset}" does not exist. Available presets: ${available}`,
        councillorResults: [],
      };
    }

    if (Object.keys(preset).length === 0) {
      return {
        success: false,
        error: `Preset "${resolvedPreset}" has no councillors configured.`,
        councillorResults: [],
      };
    }

    // ---- config defaults ----
    // T8: 显式配置优先；未配置时 timeout 作为自适应默认值，实际生效参数在
    // runCouncillors 中按 (strategy, agent) 历史成功率查自适应表获得
    const timeout = this.config.timeout ?? 180_000;
    const executionMode = this.config.councillor_execution_mode ?? 'parallel';
    const maxRounds = this.config.max_rounds ?? 2;
    const consensusThreshold = this.config.consensus_threshold ?? 0.6;
    const budget = new RetryBudget(
      this.config.max_total_retries ?? 6,
      this.config.max_elapsed_ms ?? 3 * timeout,
    );

    // ---- run ----
    const councillorResults = await this.runCouncillors(
      prompt,
      preset,
      parentSessionId,
      timeout,
      executionMode,
      budget,
      { maxRounds, consensusThreshold },
    );

    const completedCount = councillorResults.filter((r) => r.status === 'completed').length;

    if (completedCount === 0) {
      return {
        success: false,
        error: 'All councillors failed or timed out',
        councillorResults,
      };
    }

    // ---- consensus detection (T3) ----
    const consensusInputs: ConsensusInput[] = councillorResults
      .filter((r): r is CouncillorResult & { summary: CouncillorSummary } => r.status === 'completed' && !!r.summary)
      .map((r) => ({ name: r.name, summary: r.summary }));
    const consensus = computeConsensus(consensusInputs, consensusThreshold);

    const formatted = formatCouncillorResults(prompt, councillorResults);
    return {
      success: true,
      result: formatted,
      councillorResults,
      consensus: consensus.consensus,
      agreement: consensus.averageAgreement,
    };
  }

  // --------------------------------------------------------------------------
  // Private: run all councillors in parallel or serial
  // --------------------------------------------------------------------------

  private async runCouncillors(
    prompt: string,
    councillors: CouncilPreset,
    parentSessionId: string | undefined,
    timeout: number,
    executionMode: 'parallel' | 'serial',
    budget: RetryBudget,
    options: { maxRounds: number; consensusThreshold: number },
  ): Promise<CouncillorResult[]> {
    // T7: 前馈降级——按失败率升序选择 councillor，高风险模型有替代时软跳过
    const entries = orderCouncillorsByFailure(Object.entries(councillors));
    const results: CouncillorResult[] = [];

    // T8: 按 (strategy, agent) 历史成功率自适应 retries/timeout（显式配置优先，不覆盖用户意图）
    const explicitTimeout = this.config.timeout;
    const explicitRetries = this.config.councillor_retries;
    const resolveParams = (config: CouncillorConfig): { timeout: number; retries: number } => {
      const p = getAdaptiveParams(adaptiveKey(config), {
        ...DEFAULT_ADAPTIVE_CONFIG,
        defaultTimeoutMs: explicitTimeout ?? timeout,
        defaultRetries: explicitRetries ?? 3,
      });
      return {
        timeout: explicitTimeout ?? p.timeoutMs,
        retries: explicitRetries ?? p.retries,
      };
    };

    if (executionMode === 'serial') {
      // Serial mode: bounded rounds with consensus check between rounds.
      // Extra rounds draw retry budget (T3.3 + T4).
      let lastRound: CouncillorResult[] = [];
      for (let round = 1; round <= options.maxRounds; round++) {
        const roundResults: CouncillorResult[] = [];
        const firstAttemptIsExtra = round > 1;
        for (const [name, config] of entries) {
          const params = resolveParams(config);
          // P1-4: 第二轮起注入上一轮其他成员意见，驱动收敛
          const roundPrompt =
            round > 1 ? buildDeliberationPrompt(prompt, lastRound, name) : prompt;
          const r = await this.runCouncillorWithRetry(
            name, config, roundPrompt, parentSessionId, params.timeout, budget,
            { firstAttemptIsExtra, retries: params.retries },
          );
          roundResults.push(r);
        }
        lastRound = roundResults;

        const consensusInputs: ConsensusInput[] = roundResults
          .filter((r): r is CouncillorResult & { summary: CouncillorSummary } => r.status === 'completed' && !!r.summary)
          .map((r) => ({ name: r.name, summary: r.summary }));
        if (computeConsensus(consensusInputs, options.consensusThreshold).consensus) {
          break;
        }
      }
      results.push(...lastRound);
    } else {
      const promises = entries.map(([name, config]) => {
        const params = resolveParams(config);
        return this.runCouncillorWithRetry(
          name, config, prompt, parentSessionId, params.timeout, budget,
          { retries: params.retries },
        );
      });
      const settled = await Promise.allSettled(promises);
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        const [name, cfg] = entries[i];
        if (s.status === 'fulfilled') {
          results.push(s.value);
        } else {
          results.push({
            name,
            model: cfg.model,
            status: 'failed',
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          });
        }
      }
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Private: run a single councillor with retry logic
  // --------------------------------------------------------------------------

  private async runCouncillorWithRetry(
    name: string,
    config: CouncillorConfig,
    prompt: string,
    parentSessionId: string | undefined,
    timeout: number,
    budget: RetryBudget,
    options?: { firstAttemptIsExtra?: boolean; retries?: number },
  ): Promise<CouncillorResult> {
    let attemptPrompt = formatCouncillorPrompt(prompt, config.prompt);
    let attemptVariant = config.variant;
    let lastCategory: FailureCategory | null = null;
    let streak = 0;
    const categoryRetries: Partial<Record<FailureCategory, number>> = {};
    let attempt = 1;

    for (;;) {
      // ---- shared budget gates (T4) ----
      if (budget.expired()) {
        return { name, model: config.model, status: 'error', error: 'budget-exhausted' };
      }
      const isExtraAttempt = attempt > 1 || options?.firstAttemptIsExtra === true;
      if (isExtraAttempt && !budget.consumeRetry()) {
        return { name, model: config.model, status: 'error', error: 'budget-exhausted' };
      }

      let category: FailureCategory;
      let errorInfo: string;

      try {
        const session = await this.runAgentSession({
          parentSessionId,
          title: `Council ${name} (${shortModelLabel(config.model)})`,
          model: config.model,
          promptText: attemptPrompt,
          variant: attemptVariant,
          timeout,
        });

        // ---- quality gate: success but low quality -> quality-low / error ----
        const quality = assessQuality({ output: session.text, decisions: session.summary.entities.length });
        if (quality.passed) {
          // T7: 回写模型级成功统计（前馈降级的数据源）
          recordModelResult(config.model, 'success');
          // T8: 回写 (strategy, agent) 自适应样本
          recordAdaptiveSample(adaptiveKey(config), true);
          return { name, model: config.model, status: 'completed', result: session.text, summary: session.summary };
        }
        category = quality.failureCategory ?? 'quality-low';
        errorInfo = `Councillor "${name}": quality score ${quality.score} (${category})`;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        category = classifyFailure(msg);
        errorInfo = `Councillor "${name}": ${msg}`;
      }

      // ---- T7: 回写模型级失败历史（覆盖 quality-low 与 classifyFailure 两类失败点） ----
      recordModelResult(config.model, category);
      // ---- T8: 回写 (strategy, agent) 自适应样本 ----
      recordAdaptiveSample(adaptiveKey(config), false);

      // ---- T2 decision table ----
      streak = lastCategory === category ? streak + 1 : 1;
      lastCategory = category;
      const used = categoryRetries[category] ?? 0;
      const categoryLimit =
        category === 'empty' ? (options?.retries ?? this.config.councillor_retries ?? 3) : RETRY_LIMITS[category];
      const action = decideRetryAction(
        category, streak, used, budget.retriesLeft > 0 && !budget.expired(), categoryLimit,
      );

      if (action === 'needs-human') {
        return {
          name,
          model: config.model,
          status: 'needs_human',
          error: `${errorInfo} — ${streak} consecutive ${category} failures, needs human review`,
        };
      }
      if (action === 'budget-exhausted') {
        return { name, model: config.model, status: 'error', error: 'budget-exhausted' };
      }
      if (action === 'give-up') {
        return {
          name,
          model: config.model,
          status: category === 'timeout' ? 'timed_out' : 'failed',
          error: errorInfo,
        };
      }

      // ---- retry with category-specific adjustment (T2) ----
      categoryRetries[category] = used + 1;
      if (category === 'timeout') {
        attemptVariant = downgradeVariant(attemptVariant);
        attemptPrompt = appendRetryContext(attemptPrompt, 'timeout');
      } else if (category === 'quality-low') {
        attemptPrompt = appendRetryContext(attemptPrompt, 'quality-low');
      }
      attempt += 1;
    }
  }

  // --------------------------------------------------------------------------
  // Private: create and run a sub-agent session for one councillor
  // --------------------------------------------------------------------------

  private async runAgentSession(options: {
    parentSessionId?: string;
    title: string;
    agent?: string;
    model: string;
    promptText: string;
    variant?: string;
    timeout: number;
  }): Promise<{ text: string; summary: CouncillorSummary }> {
    const modelRef = parseModelReference(options.model);
    if (!modelRef) {
      throw new Error(`[oh-my-opencode-cohub] Invalid model format: ${options.model}`);
    }

    let sessionId: string | undefined;

    try {
      // ---- create child session ----
      const session = await this.client.session.create({
        body: {
          parentID: options.parentSessionId,
          title: options.title,
        },
        query: { directory: this.directory },
      });

      if (!session.data?.id) {
        throw new Error('[oh-my-opencode-cohub] Failed to create session');
      }
      sessionId = session.data.id;

      // ---- prompt the child session (read-only tools) ----
      if (!options.promptText) {
        throw new Error('[oh-my-opencode-cohub] PromptText is empty');
      }
      const promptBody: {
        agent?: string;
        model: { providerID: string; modelID: string };
        tools: Record<string, boolean>;
        parts: Array<{ type: 'text'; text: string }>;
        variant?: string;
      } = {
        model: modelRef,
        tools: {
          task: false,
          question: false,
          edit: false,
          write: false,
          apply_patch: false,
          ast_grep_replace: false,
          bash: false,
        },
        parts: [{ type: 'text', text: options.promptText }],
      };
      if (options.variant) {
        promptBody.variant = options.variant;
      }

      await promptWithTimeout(
        this.client,
        { id: sessionId },
        promptBody,
        options.timeout,
        this.directory,
      );

      // ---- extract response ----
      // P1-3: 排除 reasoning 且只取最后一条 text part，避免推理叙述（如"考虑可能失败的场景"）参与质量判定
      const extraction = await extractSessionResult(this.client, sessionId, {
        includeReasoning: false,
        lastTextOnly: true,
      });
      if (extraction.empty) {
        throw new Error('[oh-my-opencode-cohub] Empty response from provider');
      }

      const summary = extractCouncillorSummary(extraction.text);
      return { text: extraction.text, summary };
    } finally {
      // Always abort the child session after extracting the result
      if (sessionId) {
        abortSession(this.client, sessionId).catch(() => {});
      }
    }
  }
}

// ============================================================================
// createCouncilTool — registers the "council_session" tool with OpenCode
// ============================================================================

/**
 * Create the `council_session` tool definition.
 *
 * The tool launches a multi-LLM council: multiple councillors run in parallel
 * against their assigned models, and their responses are assembled into a
 * structured block for the calling (co-council) agent to synthesize.
 *
 * Only the `co-council` agent is allowed to invoke this tool.
 */
export function createCouncilTool(
  ctx: PluginInput,
  councilManager: CouncilManager,
): Record<string, ReturnType<typeof tool>> {
  const council_session = tool({
    description: [
      'Launch a multi-LLM council session for consensus-based analysis.',
      '',
      'Sends the prompt to multiple models (councillors) in parallel and returns',
      'their formatted responses for you to synthesize.',
      '',
      'Returns the councillor responses with a summary footer.',
    ].join('\n'),

    args: {
      prompt: z.string().describe(
        'The prompt to send to all councillors',
      ),
      preset: z.string().optional().describe(
        'Council preset to use (default: "default"). Must match a preset in the council config.',
      ),
    },

    async execute(
      args: { prompt: string; preset?: string },
      toolContext: { sessionID: string; agent: string },
    ): Promise<string> {
      // ---- permission check: only co-council can call this ----
      const allowedAgents = ['co-council'];
      const callingAgent = toolContext.agent;
      if (callingAgent && !allowedAgents.includes(callingAgent)) {
        throw new Error(
          `[oh-my-opencode-cohub] Council sessions can only be invoked by the co-council agent. Current agent: ${callingAgent}`,
        );
      }

      const prompt = String(args.prompt);
      const preset = typeof args.preset === 'string' ? args.preset : undefined;
      const parentSessionId = toolContext.sessionID;

      // ---- run council ----
      const result = await councilManager.runCouncil(prompt, preset, parentSessionId);

      if (!result.success) {
        return `Council session failed: ${result.error}`;
      }

      // ---- build output ----
      let output = result.result ?? '(No output)';
      const completed = result.councillorResults.filter((cr) => cr.status === 'completed').length;
      const total = result.councillorResults.length;
      const composition = formatModelComposition(result.councillorResults);

      output += `\n\n---\n*Council: ${completed}/${total} councillors responded (${composition})*`;
      // P1-2: 输出共识判定结果，parallel（默认）模式下调用方也能看到
      // P2-b: footer 对齐 synthesis 指引三档（unanimous / majority / split）：
      // consensus 且 agreement >= 0.8 → unanimous，仅 consensus → majority，否则 split
      const agreementNum = typeof result.agreement === 'number' ? result.agreement : 0;
      const consensusLabel =
        result.consensus === true
          ? agreementNum >= 0.8
            ? 'unanimous'
            : 'majority'
          : 'split';
      output += `\n*Consensus: ${consensusLabel} (${agreementNum.toFixed(2)})*`;

      return output;
    },
  });

  return { council_session };
}
