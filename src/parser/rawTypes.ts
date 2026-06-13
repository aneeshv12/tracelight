/**
 * Raw JSONL line shapes as they appear in Claude Code transcript files.
 *
 * These types are intentionally loose (lots of `unknown` and optional fields)
 * because the format is undocumented and changes between versions.
 *
 * RULE: All knowledge of the Claude Code format lives in src/parser/.
 * The rest of the codebase imports only from src/model.ts.
 */

export interface RawBase {
  readonly type: string;
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly isSidechain?: boolean;
  readonly promptId?: string;
  readonly isMeta?: boolean;
  readonly cwd?: string;
  readonly version?: string;
  readonly gitBranch?: string;
  readonly userType?: string;
  readonly entrypoint?: string;
}

// ---------------------------------------------------------------------------
// Raw content block shapes (inside message.content arrays)
// ---------------------------------------------------------------------------

export interface RawTextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface RawThinkingBlock {
  readonly type: "thinking";
  readonly thinking: string;
  readonly signature: string;
}

export interface RawToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly caller?: { type: string };
}

export interface RawToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string | Array<{ type: string; text?: string }>;
  readonly is_error?: boolean;
}

export type RawContentBlock =
  | RawTextBlock
  | RawThinkingBlock
  | RawToolUseBlock
  | RawToolResultBlock
  | { readonly type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Raw usage (token counts from API response)
// ---------------------------------------------------------------------------

export interface RawUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Raw message object (inside user/assistant JSONL lines)
// ---------------------------------------------------------------------------

export interface RawMessage {
  readonly role: "user" | "assistant";
  readonly content: string | RawContentBlock[];
  readonly model?: string;
  readonly id?: string;
  readonly type?: string;
  readonly stop_reason?: string | null;
  readonly usage?: RawUsage;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Raw line types
// ---------------------------------------------------------------------------

export interface RawUserLine extends RawBase {
  readonly type: "user";
  readonly message: RawMessage;
  readonly agentId?: string;
  /** Present on tool-result delivery lines — contains structured metadata about the result */
  readonly toolUseResult?: RawToolUseResult;
}

export interface RawAssistantLine extends RawBase {
  readonly type: "assistant";
  readonly message: RawMessage;
  readonly requestId?: string;
  readonly agentId?: string;
  readonly attributionAgent?: string;
  readonly attributionSkill?: string;
  /** toolUseResult is present on user lines that are tool results, not assistant lines */
  readonly toolUseResult?: unknown;
}

export interface RawToolResultUserLine extends RawBase {
  readonly type: "user";
  readonly message: RawMessage;
  /** Structured tool result metadata, present when message.content is a tool_result array */
  readonly toolUseResult?: RawToolUseResult;
}

export interface RawToolUseResult {
  readonly isAsync?: boolean;
  readonly status?: string;
  readonly agentId?: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly filePath?: string;
  readonly oldString?: string;
  readonly newString?: string;
  readonly [key: string]: unknown;
}

export interface RawSystemLine extends RawBase {
  readonly type: "system";
  readonly subtype?: string;
  readonly content?: string;
  readonly level?: string;
  readonly durationMs?: number;
  readonly messageCount?: number;
}

export interface RawModeLine extends RawBase {
  readonly type: "mode";
  readonly mode: string;
}

export interface RawPermissionModeLine extends RawBase {
  readonly type: "permission-mode";
  readonly permissionMode: string;
}

export interface RawFileHistorySnapshotLine extends RawBase {
  readonly type: "file-history-snapshot";
  readonly messageId?: string;
  readonly snapshot?: unknown;
  readonly isSnapshotUpdate?: boolean;
}

export interface RawAiTitleLine extends RawBase {
  readonly type: "ai-title";
  readonly aiTitle: string;
}

export interface RawLastPromptLine extends RawBase {
  readonly type: "last-prompt";
  readonly leafUuid: string;
}

export interface RawAttachmentLine extends RawBase {
  readonly type: "attachment";
  readonly attachment?: {
    readonly type: string;
    readonly [key: string]: unknown;
  };
}

export interface RawQueueOperationLine extends RawBase {
  readonly type: "queue-operation";
  readonly operation?: string;
  readonly content?: string;
}
