/**
 * Normalizing parser for Claude Code JSONL transcript files.
 *
 * Two-layer design: all knowledge of the Claude Code format lives here.
 * The rest of the codebase imports only from src/model.ts.
 *
 * Parsing strategy:
 * - Parse each line as JSON; any parse failure becomes an UnknownEvent.
 * - Recognize known line types; unrecognized types become UnknownEvent.
 * - Group conversation lines into Turns by promptId.
 * - Multiple assistant lines sharing the same message.id are merged into
 *   a single Turn (Claude Code emits streaming chunks as separate lines).
 * - Tool calls and their matching results are paired across turns.
 */

import type {
  SessionSummary,
  Turn,
  ToolCall,
  ContentBlock,
  TokenUsage,
  UnknownEvent,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
} from "../model.js";
import type {
  RawBase,
  RawUserLine,
  RawAssistantLine,
  RawContentBlock,
  RawUsage,
  RawToolUseResult,
} from "./rawTypes.js";

// ---------------------------------------------------------------------------
// Internal mutable accumulator types (not exported — parser-private)
// ---------------------------------------------------------------------------

interface MutableToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string | undefined;
  isError: boolean;
  subagentId: string | undefined;
}

interface MutableTurn {
  turnIndex: number;
  promptId: string | undefined;
  userMessageUuid: string | undefined;
  timestamp: string | undefined;
  userText: string | undefined;
  isMeta: boolean;
  assistantBlocks: ContentBlock[];
  toolCallsMap: Map<string, MutableToolCall>;
  usage: TokenUsage | undefined;
  model: string | undefined;
  durationMs: number | undefined;
  isSidechain: boolean;
  /** Internal: message.id of the last seen assistant API response for this turn */
  lastAssistantMessageId: string | undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseSessionJsonl(jsonlText: string): SessionSummary {
  const lines = jsonlText.split("\n");
  return parseLines(lines);
}

/**
 * Parses a subagent transcript's JSONL text into Turn[].
 *
 * Subagent .jsonl files use the same line format as the main transcript.
 * All their turns have isSidechain true (that flag is on the raw lines themselves).
 * This function reuses the core turn-building logic from parseLines; it extracts
 * just the turns from the resulting SessionSummary rather than duplicating logic.
 */
export function parseSubagentTurns(jsonlText: string): Turn[] {
  const lines = jsonlText.split("\n");
  const sessionSummary = parseLines(lines);
  return Array.from(sessionSummary.turns);
}

export function parseLines(lines: ReadonlyArray<string>): SessionSummary {
  const unknownEvents: UnknownEvent[] = [];
  let sessionId = "";
  let aiTitle: string | undefined;

  // Map from promptId to accumulator turn
  const turnsByPromptId = new Map<string, MutableTurn>();
  // Ordered list of turns (by first-seen order)
  const turnOrder: MutableTurn[] = [];
  // Map from tool_use_id to MutableToolCall so we can patch results later
  const toolCallsById = new Map<string, MutableToolCall>();
  // turn_duration system lines arrive after all the messages in a turn;
  // we store them indexed by the last-seen promptId at the time
  let lastSeenPromptId: string | undefined;

  // System turn_duration events: keyed by promptId to patch durationMs
  const durationByPromptId = new Map<string, number>();

  // Models set
  const modelsUsed = new Set<string>();

  let turnIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex].trim();
    if (rawLine === "") continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      unknownEvents.push({
        kind: "unknown",
        rawType: "<json-parse-error>",
        rawPayload: { rawLine },
        lineIndex,
      });
      continue;
    }

    const lineType = typeof parsed["type"] === "string" ? parsed["type"] : "";

    // Capture sessionId from any line that has it
    if (typeof parsed["sessionId"] === "string" && parsed["sessionId"]) {
      sessionId = parsed["sessionId"];
    }

    switch (lineType) {
      case "ai-title": {
        if (typeof parsed["aiTitle"] === "string") {
          aiTitle = parsed["aiTitle"];
        }
        break;
      }

      case "system": {
        const subtype = parsed["subtype"];
        if (subtype === "turn_duration" && typeof parsed["durationMs"] === "number") {
          if (lastSeenPromptId !== undefined) {
            durationByPromptId.set(lastSeenPromptId, parsed["durationMs"] as number);
          }
        }
        // Other system subtypes (local_command, etc.) are informational — skip silently
        break;
      }

      case "user": {
        const userLine = parsed as unknown as RawUserLine;
        const message = userLine.message;
        if (!message) break;

        const promptId = userLine.promptId;
        const isSidechain = userLine.isSidechain === true;

        // Check if this user line contains tool_result blocks (tool result delivery)
        const content = message.content;
        if (Array.isArray(content)) {
          const toolResultBlocks = content.filter(
            (block) =>
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>)["type"] === "tool_result"
          );

          if (toolResultBlocks.length > 0) {
            // This is a tool-result delivery line — patch the matching ToolCall
            for (const block of toolResultBlocks) {
              const resultBlock = block as Record<string, unknown>;
              const toolUseId = resultBlock["tool_use_id"];
              if (typeof toolUseId !== "string") continue;

              const toolCall = toolCallsById.get(toolUseId);
              if (!toolCall) continue;

              const isError = resultBlock["is_error"] === true;
              toolCall.isError = isError;

              const blockContent = resultBlock["content"];
              if (typeof blockContent === "string") {
                toolCall.result = blockContent;
              } else if (Array.isArray(blockContent)) {
                // Agent tool returns array of text blocks
                const textParts = blockContent
                  .filter((b) => typeof b === "object" && b !== null && (b as Record<string, unknown>)["type"] === "text")
                  .map((b) => String((b as Record<string, unknown>)["text"] ?? ""));
                toolCall.result = textParts.join("\n");
              }

              // For Agent tool: extract subagentId from toolUseResult
              const toolUseResult = userLine.toolUseResult as RawToolUseResult | undefined;
              if (toolUseResult && typeof toolUseResult["agentId"] === "string") {
                toolCall.subagentId = toolUseResult["agentId"];
              }
            }
            // Don't create a new Turn for tool-result-only user lines
            break;
          }
        }

        // Regular user message — open or update a Turn for this promptId.
        if (promptId === undefined) break;

        lastSeenPromptId = promptId;

        if (!turnsByPromptId.has(promptId)) {
          const newTurn: MutableTurn = {
            turnIndex: turnIndex++,
            promptId,
            userMessageUuid: userLine.uuid,
            timestamp: userLine.timestamp,
            userText: extractUserText(message.content),
            isMeta: userLine.isMeta === true,
            assistantBlocks: [],
            toolCallsMap: new Map(),
            usage: undefined,
            model: undefined,
            durationMs: undefined,
            isSidechain,
            lastAssistantMessageId: undefined,
          };
          turnsByPromptId.set(promptId, newTurn);
          turnOrder.push(newTurn);
        } else {
          // A turn for this promptId already exists (opened by a meta or assistant line).
          // If this user line is non-meta and has real text, upgrade the turn's user fields.
          const existingTurn = turnsByPromptId.get(promptId)!;
          if (userLine.isMeta !== true) {
            const text = extractUserText(message.content);
            if (text !== undefined) {
              existingTurn.userText = text;
              existingTurn.isMeta = false;
              existingTurn.userMessageUuid = userLine.uuid;
              if (userLine.timestamp) {
                existingTurn.timestamp = userLine.timestamp;
              }
            }
          }
        }
        break;
      }

      case "assistant": {
        const assistantLine = parsed as unknown as RawAssistantLine;
        const message = assistantLine.message;
        if (!message) break;

        // Assistant lines frequently lack promptId in real transcripts.
        // Fall back to the most recently seen promptId from a user line.
        const promptId = assistantLine.promptId ?? lastSeenPromptId;
        if (promptId === undefined) break;

        // Only update lastSeenPromptId if the line has an explicit value (don't
        // let assistant lines overwrite a user-established promptId with undefined).
        if (assistantLine.promptId !== undefined) {
          lastSeenPromptId = assistantLine.promptId;
        }

        // Get or create the Turn (assistant lines can arrive before the corresponding
        // user line when the file records them out of strict order — be defensive)
        if (!turnsByPromptId.has(promptId)) {
          const newTurn: MutableTurn = {
            turnIndex: turnIndex++,
            promptId,
            userMessageUuid: undefined,
            timestamp: assistantLine.timestamp,
            userText: undefined,
            isMeta: false,
            assistantBlocks: [],
            toolCallsMap: new Map(),
            usage: undefined,
            model: undefined,
            durationMs: undefined,
            isSidechain: assistantLine.isSidechain === true,
            lastAssistantMessageId: undefined,
          };
          turnsByPromptId.set(promptId, newTurn);
          turnOrder.push(newTurn);
        }

        const turn = turnsByPromptId.get(promptId)!;

        // Track message id to merge streaming chunks
        const apiMessageId = message.id;
        const isNewApiMessage =
          apiMessageId !== undefined &&
          apiMessageId !== turn.lastAssistantMessageId;

        if (apiMessageId !== undefined) {
          turn.lastAssistantMessageId = apiMessageId;
        }

        // Capture usage only from the first line per API message (they're duplicated
        // across streaming chunk lines — all have the same usage totals)
        if (isNewApiMessage && message.usage) {
          turn.usage = normalizeUsage(message.usage as RawUsage);
        }

        if (message.model && typeof message.model === "string") {
          turn.model = message.model;
          modelsUsed.add(message.model);
        }

        // Parse content blocks
        const rawContent = message.content;
        const rawBlocks: RawContentBlock[] = Array.isArray(rawContent)
          ? (rawContent as RawContentBlock[])
          : [];

        for (const rawBlock of rawBlocks) {
          if (typeof rawBlock !== "object" || rawBlock === null) continue;
          const block = normalizeContentBlock(rawBlock);
          if (block === null) continue;

          turn.assistantBlocks.push(block);

          // Register tool_use blocks so we can match results later
          if (block.type === "tool_use") {
            const toolCall: MutableToolCall = {
              id: block.id,
              name: block.name,
              input: block.input,
              result: undefined,
              isError: false,
              subagentId: undefined,
            };
            turn.toolCallsMap.set(block.id, toolCall);
            toolCallsById.set(block.id, toolCall);
          }
        }
        break;
      }

      // Metadata lines — recognized and silently consumed
      case "mode":
      case "permission-mode":
      case "file-history-snapshot":
      case "last-prompt":
      case "attachment":
      case "queue-operation":
        break;

      default: {
        unknownEvents.push({
          kind: "unknown",
          rawType: lineType || "<missing>",
          rawPayload: parsed,
          lineIndex,
        });
      }
    }
  }

  // Patch durationMs into turns
  for (const [promptId, durationMs] of durationByPromptId) {
    const turn = turnsByPromptId.get(promptId);
    if (turn) {
      turn.durationMs = durationMs;
    }
  }

  // Freeze turns into immutable Turn objects
  const frozenTurns: Turn[] = turnOrder.map((mutableTurn) =>
    freezeTurn(mutableTurn)
  );

  // Compute aggregate token usage
  const totalUsage = aggregateUsage(frozenTurns);

  // Derive start/end timestamps
  const timestamps = frozenTurns
    .map((t) => t.timestamp)
    .filter((ts): ts is string => ts !== undefined)
    .sort();
  const startedAt = timestamps[0];
  const endedAt = timestamps[timestamps.length - 1];
  const durationMs =
    startedAt && endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : undefined;

  return {
    sessionId,
    aiTitle,
    startedAt,
    endedAt,
    durationMs,
    turns: frozenTurns,
    subagents: [],
    totalUsage,
    modelsUsed: Array.from(modelsUsed),
    unknownEvents,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeContentBlock(rawBlock: RawContentBlock): ContentBlock | null {
  const blockType = rawBlock.type;

  switch (blockType) {
    case "text": {
      const b = rawBlock as { type: "text"; text?: unknown };
      return {
        type: "text",
        text: typeof b.text === "string" ? b.text : "",
      } satisfies TextBlock;
    }

    case "thinking": {
      const b = rawBlock as { type: "thinking"; thinking?: unknown; signature?: unknown };
      return {
        type: "thinking",
        thinking: typeof b.thinking === "string" ? b.thinking : "",
        signature: typeof b.signature === "string" ? b.signature : "",
      } satisfies ThinkingBlock;
    }

    case "tool_use": {
      const b = rawBlock as { type: "tool_use"; id?: unknown; name?: unknown; input?: unknown };
      const id = typeof b.id === "string" ? b.id : "";
      const name = typeof b.name === "string" ? b.name : "";
      const input =
        b.input !== null && typeof b.input === "object" && !Array.isArray(b.input)
          ? (b.input as Record<string, unknown>)
          : {};
      return { type: "tool_use", id, name, input } satisfies ToolUseBlock;
    }

    case "tool_result": {
      const b = rawBlock as {
        type: "tool_result";
        tool_use_id?: unknown;
        content?: unknown;
        is_error?: unknown;
      };
      const toolUseId = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
      let content: string | ReadonlyArray<TextBlock>;
      if (typeof b.content === "string") {
        content = b.content;
      } else if (Array.isArray(b.content)) {
        content = (b.content as Array<Record<string, unknown>>)
          .filter((item) => item["type"] === "text")
          .map((item) => ({ type: "text" as const, text: String(item["text"] ?? "") }));
      } else {
        content = "";
      }
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content,
        is_error: b.is_error === true,
      } satisfies ToolResultBlock;
    }

    default:
      // Unknown content block type — skip rather than crash
      return null;
  }
}

function normalizeUsage(rawUsage: RawUsage): TokenUsage {
  return {
    inputTokens: rawUsage.input_tokens ?? 0,
    outputTokens: rawUsage.output_tokens ?? 0,
    cacheCreationInputTokens: rawUsage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: rawUsage.cache_read_input_tokens ?? 0,
  };
}

function extractUserText(content: unknown): string | undefined {
  if (typeof content === "string") {
    // Strip known XML wrappers that Claude Code injects
    const stripped = content
      .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
      .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
      .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
      .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
      .trim();
    return stripped || undefined;
  }
  if (Array.isArray(content)) {
    // List content is typically tool results — not a user text message
    return undefined;
  }
  return undefined;
}

function freezeTurn(mutableTurn: MutableTurn): Turn {
  const toolCalls: ToolCall[] = Array.from(mutableTurn.toolCallsMap.values()).map(
    (tc) => ({
      id: tc.id,
      name: tc.name,
      input: tc.input,
      result: tc.result,
      isError: tc.isError,
      subagentId: tc.subagentId,
    })
  );

  return {
    turnIndex: mutableTurn.turnIndex,
    promptId: mutableTurn.promptId,
    userMessageUuid: mutableTurn.userMessageUuid,
    timestamp: mutableTurn.timestamp,
    userText: mutableTurn.userText,
    isMeta: mutableTurn.isMeta,
    assistantBlocks: mutableTurn.assistantBlocks,
    toolCalls,
    usage: mutableTurn.usage,
    model: mutableTurn.model,
    durationMs: mutableTurn.durationMs,
    isSidechain: mutableTurn.isSidechain,
  };
}

function aggregateUsage(turns: ReadonlyArray<Turn>): TokenUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;

  for (const turn of turns) {
    if (turn.usage) {
      inputTokens += turn.usage.inputTokens;
      outputTokens += turn.usage.outputTokens;
      cacheCreationInputTokens += turn.usage.cacheCreationInputTokens;
      cacheReadInputTokens += turn.usage.cacheReadInputTokens;
    }
  }

  return { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens };
}
