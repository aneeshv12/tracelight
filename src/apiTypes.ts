/**
 * JSON API response types shared between the Fastify server and the React UI.
 *
 * These are the only types the UI imports from src/. They are derived
 * from model.ts but shaped for over-the-wire JSON (no ReadonlyArray, etc.).
 * The server serializes SessionSummary into these; the UI renders these.
 *
 * Rule: the UI must compile without importing anything from src/parser/.
 */

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

// ---------------------------------------------------------------------------
// Content block JSON variants (mirrors model.ts ContentBlock, minus readonly)
// ---------------------------------------------------------------------------

export interface TextBlockJson {
  type: "text";
  text: string;
}

export interface ThinkingBlockJson {
  type: "thinking";
  /** Opaque signature field from the API is intentionally dropped here. */
  thinking: string;
}

export interface ToolUseBlockJson {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlockJson {
  type: "tool_result";
  tool_use_id: string;
  content: string | TextBlockJson[];
  is_error?: boolean;
}

export type ContentBlockJson =
  | TextBlockJson
  | ThinkingBlockJson
  | ToolUseBlockJson
  | ToolResultBlockJson;

// ---------------------------------------------------------------------------
// Tool call JSON (mirrors model.ts ToolCall, minus readonly)
// ---------------------------------------------------------------------------

export interface ToolCallJson {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string | undefined;
  isError: boolean;
  subagentId: string | undefined;
}

// ---------------------------------------------------------------------------
// Turn JSON (mirrors model.ts Turn, minus readonly and userMessageUuid)
// ---------------------------------------------------------------------------

/**
 * One normalized conversation round-trip, serialized for the API.
 * Includes all turns (meta and sidechain) in parser order; the UI decides what to render.
 */
export interface TurnJson {
  turnIndex: number;
  promptId: string | undefined;
  timestamp: string | undefined;
  userText: string | undefined;
  isMeta: boolean;
  assistantBlocks: ContentBlockJson[];
  toolCalls: ToolCallJson[];
  usage: TokenUsageSummary | undefined;
  model: string | undefined;
  durationMs: number | undefined;
  isSidechain: boolean;
}

/**
 * Lightweight per-session summary for the home view list.
 * Avoids sending full turn content in the project list response.
 */
export interface SessionListItem {
  sessionId: string;
  /** Path to the source .jsonl file on disk (for /api/sessions/:id lookups). */
  filePath: string;
  aiTitle: string | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
  durationMs: number | undefined;
  /** Count of non-meta turns. */
  turnCount: number;
  totalUsage: TokenUsageSummary;
  modelsUsed: string[];
  unknownEventCount: number;
}

/**
 * A Claude Code "project" — one slug directory under ~/.claude/projects/.
 * The slug is the cwd path with slashes replaced by hyphens.
 */
export interface ProjectListing {
  /** Directory basename under ~/.claude/projects/, e.g. "-Users-alice-myproject". */
  slug: string;
  /** Human-readable project name derived from the slug. */
  displayName: string;
  sessions: SessionListItem[];
  /** Timestamp of the most recent session start, for sorting. */
  mostRecentSessionAt: string | undefined;
}

// ---------------------------------------------------------------------------
// Subagent trace JSON (mirrors model.ts SubagentTrace, minus readonly)
// ---------------------------------------------------------------------------

/** One subagent spawned during the session, with its own parsed turns. */
export interface SubagentTraceJson {
  agentId: string;
  agentType: string;
  description: string;
  /** The tool_use_id in the parent session that spawned this subagent. */
  parentToolUseId: string;
  turns: TurnJson[];
}

// ---------------------------------------------------------------------------
// Pricing table JSON (mirrors src/pricing.ts shapes — no import from pricing.ts)
// ---------------------------------------------------------------------------

/** USD per 1 million tokens for one model family. */
export interface ModelPricingJson {
  inputPer1M: number;
  outputPer1M: number;
  cacheWritePer1M: number;
  cacheReadPer1M: number;
}

/** Full pricing table as sent over the wire. */
export interface PricingTableJson {
  /** ISO date string: when the table was last verified against Anthropic's public prices. */
  asOfDate: string;
  /** Map from model-family prefix (e.g. "claude-sonnet") to pricing. */
  models: Record<string, ModelPricingJson>;
}

/**
 * Full session detail returned by /api/sessions/:id.
 * Includes the full turns array so the trace-view UI can render the conversation.
 */
export interface SessionDetail {
  sessionId: string;
  filePath: string;
  aiTitle: string | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
  durationMs: number | undefined;
  turnCount: number;
  totalUsage: TokenUsageSummary;
  modelsUsed: string[];
  unknownEventCount: number;
  /** All turns in parser order (meta and sidechain turns included, flagged by isMeta/isSidechain). */
  turns: TurnJson[];
  /** Subagent traces spawned during this session, each with their own turns. */
  subagents: SubagentTraceJson[];
  /** Pricing table snapshot included so the UI can compute cost estimates client-side. */
  pricing: PricingTableJson;
}
