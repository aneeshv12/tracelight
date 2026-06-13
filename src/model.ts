/**
 * Stable internal model for tracelight.
 *
 * All types here are derived from observation of real Claude Code JSONL transcripts.
 * The UI imports only from this file — never from src/parser/.
 *
 * Key observations from real transcripts:
 * - Each JSONL line is a raw event with a `type` field.
 * - Conversation lines have type "user" or "assistant" and carry a `message` object.
 * - Multiple assistant lines can share the same API message id (streaming continuation).
 * - Tool calls appear as content blocks with type "tool_use" inside an assistant message.
 * - Tool results appear as content blocks with type "tool_result" inside a user message.
 * - Subagents live in a separate JSONL file under subagents/<agentId>.jsonl.
 * - Subagent spawning is visible as an "Agent" tool_use in the parent; the matching
 *   user-side tool_result carries toolUseResult.agentId linking to the subagent file.
 * - Session metadata is scattered: "mode", "permission-mode", "file-history-snapshot",
 *   "ai-title", "last-prompt", "queue-operation", "attachment", "system" lines.
 */

// ---------------------------------------------------------------------------
// Content block variants (inside assistant/user message.content arrays)
// ---------------------------------------------------------------------------

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ThinkingBlock {
  readonly type: "thinking";
  readonly thinking: string;
  /** Opaque signature from the API — preserved but not interpreted. */
  readonly signature: string;
}

export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  /** Result content — string for most tools, array of text blocks for Agent tool. */
  readonly content: string | ReadonlyArray<TextBlock>;
  readonly is_error?: boolean;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;

// ---------------------------------------------------------------------------
// Usage / token counts
// ---------------------------------------------------------------------------

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

// ---------------------------------------------------------------------------
// Tool call (parsed, not raw)
// ---------------------------------------------------------------------------

export interface ToolCall {
  /** Matches tool_use block id */
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  /**
   * Result populated when the matching tool_result line is parsed.
   * Undefined until the result is seen (may stay undefined for incomplete traces).
   */
  readonly result: string | undefined;
  readonly isError: boolean;
  /**
   * For "Agent" tool calls: the agentId of the spawned subagent.
   * Populated from the user-side toolUseResult.agentId field.
   */
  readonly subagentId: string | undefined;
}

// ---------------------------------------------------------------------------
// Subagent (sidechain) reference
// ---------------------------------------------------------------------------

export interface SubagentTrace {
  /** Unique agent id — matches filename under subagents/ directory. */
  readonly agentId: string;
  readonly description: string;
  readonly agentType: string;
  /** The tool_use_id in the parent that spawned this subagent. */
  readonly parentToolUseId: string;
  /** Full parsed turns from the subagent's own JSONL (populated in milestone 4). */
  readonly turns: ReadonlyArray<Turn>;
}

// ---------------------------------------------------------------------------
// Turn (normalized unit of conversation)
// ---------------------------------------------------------------------------

/**
 * A Turn groups one round-trip: a user message followed by all assistant response
 * lines that belong to it (same promptId), plus any tool calls and results.
 *
 * Claude Code emits multiple assistant JSONL lines per logical turn because:
 *   1. Streaming: individual text/thinking/tool_use blocks arrive as separate lines
 *      that share the same message.id.
 *   2. Sidechain turns for subagent context are written before the main response.
 *
 * The parser merges same-message-id assistant lines into one Turn.
 */
export interface Turn {
  readonly turnIndex: number;
  readonly promptId: string | undefined;
  /** UUID of the user JSONL line that opened this turn. */
  readonly userMessageUuid: string | undefined;
  /** Timestamp of the user message that opened this turn. */
  readonly timestamp: string | undefined;
  /** Human-readable text from the user message (stripped of XML wrappers). */
  readonly userText: string | undefined;
  /** Whether this is a meta / internal message (slash commands, local-command output). */
  readonly isMeta: boolean;
  /** All content blocks from merged assistant lines, in order. */
  readonly assistantBlocks: ReadonlyArray<ContentBlock>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly usage: TokenUsage | undefined;
  readonly model: string | undefined;
  readonly durationMs: number | undefined;
  /** True when this turn belongs to a subagent context (isSidechain flag on raw line). */
  readonly isSidechain: boolean;
}

// ---------------------------------------------------------------------------
// Unknown / unrecognized event (defensive fallback)
// ---------------------------------------------------------------------------

export interface UnknownEvent {
  readonly kind: "unknown";
  /** The raw `type` field value from the JSONL line, or "<missing>" if absent. */
  readonly rawType: string;
  /** The full parsed JSON object from the line. */
  readonly rawPayload: Record<string, unknown>;
  readonly lineIndex: number;
}

// ---------------------------------------------------------------------------
// Session summary (top-level output of the parser)
// ---------------------------------------------------------------------------

export interface SessionSummary {
  readonly sessionId: string;
  readonly aiTitle: string | undefined;
  readonly startedAt: string | undefined;
  readonly endedAt: string | undefined;
  /** Duration in ms derived from first/last timestamps. */
  readonly durationMs: number | undefined;
  /** All normalized turns, in order. Meta turns are included but flagged. */
  readonly turns: ReadonlyArray<Turn>;
  /** Subagent traces referenced by this session (populated in milestone 4). */
  readonly subagents: ReadonlyArray<SubagentTrace>;
  /** Total tokens across all turns. */
  readonly totalUsage: TokenUsage;
  /** Distinct model ids used. */
  readonly modelsUsed: ReadonlyArray<string>;
  /** Lines the parser could not interpret — for UI display, never crashes. */
  readonly unknownEvents: ReadonlyArray<UnknownEvent>;
}
