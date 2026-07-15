// src/tools/council.ts
//
// Multi-LLM council session tool for oh-my-opencode-cohub.
// Mirrors oh-my-opencode-slim's council implementation with cohub-specific
// agent naming and simplified depth tracking.

import { tool } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import type { createOpencodeClient } from '@opencode-ai/sdk';
import type { TextPart, ReasoningPart } from '@opencode-ai/sdk';

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
  /** Retries on empty response (default: 3) */
  councillor_retries?: number;
}

/** Internal councillor result shape */
interface CouncillorResult {
  name: string;
  model: string;
  status: string;
  result?: string;
  error?: string;
}

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
  } catch {
    // silent — best effort cleanup
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
            reject(new OperationTimeoutError(`Prompt timed out after ${timeoutMs}ms`));
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
  options?: { includeReasoning?: boolean },
): Promise<{ text: string; empty: boolean }> {
  const includeReasoning = options?.includeReasoning ?? true;
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

  const text = extractedContent.filter((t) => t.length > 0).join('\n\n');
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
 * Build a human-readable model composition string.
 * e.g. "expert1: gpt-4, expert2: claude-3"
 */
function formatModelComposition(councillorResults: CouncillorResult[]): string {
  return councillorResults
    .map((cr) => `${cr.name}: ${shortModelLabel(cr.model)}`)
    .join(', ');
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
    const timeout = this.config.timeout ?? 180_000;
    const executionMode = this.config.councillor_execution_mode ?? 'parallel';
    const maxRetries = this.config.councillor_retries ?? 3;

    // ---- run ----
    const councillorResults = await this.runCouncillors(
      prompt,
      preset,
      parentSessionId,
      timeout,
      executionMode,
      maxRetries,
    );

    const completedCount = councillorResults.filter((r) => r.status === 'completed').length;

    if (completedCount === 0) {
      return {
        success: false,
        error: 'All councillors failed or timed out',
        councillorResults,
      };
    }

    const formatted = formatCouncillorResults(prompt, councillorResults);
    return {
      success: true,
      result: formatted,
      councillorResults,
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
    maxRetries: number,
  ): Promise<CouncillorResult[]> {
    const entries = Object.entries(councillors);
    const results: CouncillorResult[] = [];

    if (executionMode === 'serial') {
      for (const [name, config] of entries) {
        const r = await this.runCouncillorWithRetry(
          name, config, prompt, parentSessionId, timeout, maxRetries,
        );
        results.push(r);
      }
    } else {
      const promises = entries.map(([name, config]) =>
        this.runCouncillorWithRetry(name, config, prompt, parentSessionId, timeout, maxRetries),
      );
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
    maxRetries: number,
  ): Promise<CouncillorResult> {
    const totalAttempts = 1 + maxRetries;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        const result = await this.runAgentSession({
          parentSessionId,
          title: `Council ${name} (${shortModelLabel(config.model)})`,
          model: config.model,
          promptText: formatCouncillorPrompt(prompt, config.prompt),
          variant: config.variant,
          timeout,
        });
        return { name, model: config.model, status: 'completed', result };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isEmptyResponse = msg.includes('Empty response from provider');
        const canRetry = attempt < totalAttempts && isEmptyResponse;

        if (!canRetry) {
          return {
            name,
            model: config.model,
            status: msg.includes('timed out') ? 'timed_out' : 'failed',
            error: `Councillor "${name}": ${msg}`,
          };
        }
        // else: retry
      }
    }

    return {
      name,
      model: config.model,
      status: 'failed',
      error: `Councillor "${name}": max retries exhausted`,
    };
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
  }): Promise<string> {
    const modelRef = parseModelReference(options.model);
    if (!modelRef) {
      throw new Error(`Invalid model format: ${options.model}`);
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
        throw new Error('Failed to create session');
      }
      sessionId = session.data.id;

      // ---- prompt the child session (read-only tools) ----
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
      const extraction = await extractSessionResult(this.client, sessionId);
      if (extraction.empty) {
        throw new Error('Empty response from provider');
      }

      return extraction.text;
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
          `Council sessions can only be invoked by the co-council agent. Current agent: ${callingAgent}`,
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

      return output;
    },
  });

  return { council_session };
}
