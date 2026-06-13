/**
 * Project loader: discovers Claude Code projects from ~/.claude/projects/ and
 * parses their .jsonl session files into the internal model.
 *
 * This module is the only place that knows about the ~/.claude/projects/
 * directory layout. The server and UI import only the types from apiTypes.ts
 * and model.ts — never the raw parser shapes.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";
import { parseSessionJsonl, parseSubagentTurns } from "./parser/index.js";
import type { SessionSummary, Turn, ContentBlock, ToolCall, TokenUsage, SubagentTrace } from "./model.js";
import { MODEL_PRICING, PRICING_AS_OF_DATE } from "./pricing.js";
import type {
  ProjectListing,
  SessionListItem,
  SessionDetail,
  TurnJson,
  ContentBlockJson,
  ToolCallJson,
  TextBlockJson,
  TokenUsageSummary,
  SubagentTraceJson,
  PricingTableJson,
} from "./apiTypes.js";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Reads a single .jsonl file and returns its SessionSummary, including populated subagents.
 * Returns null on any read or parse failure (defensive).
 */
export function loadSession(filePath: string): SessionSummary | null {
  try {
    const jsonlText = readFileSync(filePath, "utf-8");
    const baseSummary = parseSessionJsonl(jsonlText);
    const subagents = loadSubagentsForSession(filePath);
    return { ...baseSummary, subagents };
  } catch {
    return null;
  }
}

/**
 * Derives the subagents sidecar directory from the session file path,
 * then reads each agent-*.jsonl + agent-*.meta.json pair into a SubagentTrace.
 *
 * Layout: <dirOfFile>/<basenameWithout.jsonl>/subagents/
 *
 * Missing directory, missing/corrupt meta, or unreadable agent file all result
 * in that subagent being silently skipped — never throws.
 */
function loadSubagentsForSession(sessionFilePath: string): SubagentTrace[] {
  const sessionFileBasename = basename(sessionFilePath);
  const sessionId = sessionFileBasename.endsWith(".jsonl")
    ? sessionFileBasename.slice(0, -".jsonl".length)
    : sessionFileBasename;

  const subagentDir = join(dirname(sessionFilePath), sessionId, "subagents");

  if (!existsSync(subagentDir)) {
    return [];
  }

  let dirEntries: string[];
  try {
    dirEntries = readdirSync(subagentDir);
  } catch {
    return [];
  }

  const agentJsonlFiles = dirEntries.filter(
    (name) => name.startsWith("agent-") && name.endsWith(".jsonl")
  );

  const subagentTraces: SubagentTrace[] = [];

  for (const agentJsonlFilename of agentJsonlFiles) {
    const agentId = agentJsonlFilename
      .replace(/^agent-/, "")
      .replace(/\.jsonl$/, "");

    const agentJsonlPath = join(subagentDir, agentJsonlFilename);
    const agentMetaPath = join(subagentDir, `agent-${agentId}.meta.json`);

    try {
      const agentJsonlText = readFileSync(agentJsonlPath, "utf-8");
      const agentMetaText = readFileSync(agentMetaPath, "utf-8");

      const meta = JSON.parse(agentMetaText) as Record<string, unknown>;

      const agentType = typeof meta["agentType"] === "string" ? meta["agentType"] : "unknown";
      const description = typeof meta["description"] === "string" ? meta["description"] : "";
      const parentToolUseId = typeof meta["toolUseId"] === "string" ? meta["toolUseId"] : "";

      const turns = parseSubagentTurns(agentJsonlText);

      subagentTraces.push({ agentId, agentType, description, parentToolUseId, turns });
    } catch {
      // Skip this subagent — missing or corrupt file
      continue;
    }
  }

  return subagentTraces;
}

/**
 * Converts a SessionSummary to the lightweight SessionListItem shape for the API.
 */
export function toSessionListItem(
  sessionSummary: SessionSummary,
  filePath: string
): SessionListItem {
  const nonMetaTurnCount = sessionSummary.turns.filter((t) => !t.isMeta).length;
  return {
    sessionId: sessionSummary.sessionId,
    filePath,
    aiTitle: sessionSummary.aiTitle,
    startedAt: sessionSummary.startedAt,
    endedAt: sessionSummary.endedAt,
    durationMs: sessionSummary.durationMs,
    turnCount: nonMetaTurnCount,
    totalUsage: {
      inputTokens: sessionSummary.totalUsage.inputTokens,
      outputTokens: sessionSummary.totalUsage.outputTokens,
      cacheCreationInputTokens: sessionSummary.totalUsage.cacheCreationInputTokens,
      cacheReadInputTokens: sessionSummary.totalUsage.cacheReadInputTokens,
    },
    modelsUsed: Array.from(sessionSummary.modelsUsed),
    unknownEventCount: sessionSummary.unknownEvents.length,
  };
}

/**
 * Converts a TokenUsage to the over-the-wire TokenUsageSummary shape.
 */
function toTokenUsageSummary(usage: TokenUsage): TokenUsageSummary {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
  };
}

/**
 * Converts a ContentBlock (model) to a ContentBlockJson (API wire type).
 * ThinkingBlock's opaque `signature` field is intentionally dropped.
 */
function toContentBlockJson(block: ContentBlock): ContentBlockJson {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return { type: "thinking", thinking: block.thinking };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result": {
      const content =
        typeof block.content === "string"
          ? block.content
          : Array.from(block.content).map(
              (textBlock): TextBlockJson => ({ type: "text", text: textBlock.text })
            );
      const resultBlock: ContentBlockJson = {
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content,
      };
      if (block.is_error !== undefined) {
        return { ...resultBlock, is_error: block.is_error };
      }
      return resultBlock;
    }
  }
}

/**
 * Converts a ToolCall (model) to ToolCallJson (API wire type).
 */
function toToolCallJson(toolCall: ToolCall): ToolCallJson {
  return {
    id: toolCall.id,
    name: toolCall.name,
    input: toolCall.input,
    result: toolCall.result,
    isError: toolCall.isError,
    subagentId: toolCall.subagentId,
  };
}

/**
 * Converts a Turn (model) to TurnJson (API wire type).
 * The userMessageUuid field is not sent to the UI.
 */
function toTurnJson(turn: Turn): TurnJson {
  return {
    turnIndex: turn.turnIndex,
    promptId: turn.promptId,
    timestamp: turn.timestamp,
    userText: turn.userText,
    isMeta: turn.isMeta,
    assistantBlocks: Array.from(turn.assistantBlocks).map(toContentBlockJson),
    toolCalls: Array.from(turn.toolCalls).map(toToolCallJson),
    usage: turn.usage !== undefined ? toTokenUsageSummary(turn.usage) : undefined,
    model: turn.model,
    durationMs: turn.durationMs,
    isSidechain: turn.isSidechain,
  };
}

/**
 * Converts a SubagentTrace (model) to SubagentTraceJson (API wire type).
 * Reuses toTurnJson for each subagent turn to keep the mapping consistent.
 */
function toSubagentTraceJson(subagent: SubagentTrace): SubagentTraceJson {
  return {
    agentId: subagent.agentId,
    agentType: subagent.agentType,
    description: subagent.description,
    parentToolUseId: subagent.parentToolUseId,
    turns: Array.from(subagent.turns).map(toTurnJson),
  };
}

/**
 * Builds the pricing table payload from the hand-maintained MODEL_PRICING table.
 * MODEL_PRICING values are structurally identical to ModelPricingJson so they
 * can be spread directly; the readonly modifier on the source fields is erased at runtime.
 */
function buildPricingTableJson(): PricingTableJson {
  const models: Record<string, { inputPer1M: number; outputPer1M: number; cacheWritePer1M: number; cacheReadPer1M: number }> = {};
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    models[prefix] = {
      inputPer1M: pricing.inputPer1M,
      outputPer1M: pricing.outputPer1M,
      cacheWritePer1M: pricing.cacheWritePer1M,
      cacheReadPer1M: pricing.cacheReadPer1M,
    };
  }
  return { asOfDate: PRICING_AS_OF_DATE, models };
}

/**
 * Converts a SessionSummary to the full SessionDetail shape for the /api/sessions/:id endpoint.
 * All turns are included in parser order; the UI decides which to render.
 */
export function toSessionDetail(
  sessionSummary: SessionSummary,
  filePath: string
): SessionDetail {
  const nonMetaTurnCount = sessionSummary.turns.filter((t) => !t.isMeta).length;
  return {
    sessionId: sessionSummary.sessionId,
    filePath,
    aiTitle: sessionSummary.aiTitle,
    startedAt: sessionSummary.startedAt,
    endedAt: sessionSummary.endedAt,
    durationMs: sessionSummary.durationMs,
    turnCount: nonMetaTurnCount,
    totalUsage: toTokenUsageSummary(sessionSummary.totalUsage),
    modelsUsed: Array.from(sessionSummary.modelsUsed),
    unknownEventCount: sessionSummary.unknownEvents.length,
    turns: Array.from(sessionSummary.turns).map(toTurnJson),
    subagents: Array.from(sessionSummary.subagents).map(toSubagentTraceJson),
    pricing: buildPricingTableJson(),
  };
}

/**
 * Derives a human-readable display name from the slug.
 * The slug is a cwd path with slashes replaced by hyphens, e.g.:
 *   "-Users-alice-Documents-independent-stuff-leetcode" → "Documents/independent-stuff/leetcode"
 *   "-home-bob-project" → "project"
 *   "-Users-alice" → "Users/alice" (no home-dir prefix match, show as-is)
 *
 * Strips leading "-Users-<username>-" or "-home-<username>-" (the home-dir prefix),
 * then shows the last 2 path segments joined by "/" for readability.
 * If slug doesn't match home patterns or is malformed, falls back to the last segment alone.
 */
function slugToDisplayName(slug: string): string {
  // Normalize: remove leading hyphen
  const normalized = slug.startsWith("-") ? slug.slice(1) : slug;
  const parts = normalized.split("-").filter((s) => s.length > 0);

  if (parts.length === 0) {
    return slug;
  }

  // Try to detect and strip home-dir prefix: "-Users-<username>-" or "-home-<username>-"
  let remainingParts = parts;
  if (parts.length >= 2) {
    const firstPart = parts[0];
    if (firstPart === "Users" || firstPart === "home") {
      // Skip the next part (username) and keep the rest
      remainingParts = parts.slice(2);
    }
  }

  // If we stripped everything, fall back to original last segment
  if (remainingParts.length === 0) {
    return parts[parts.length - 1];
  }

  // Show the last 2 path segments, joined by "/"
  const numToShow = Math.min(2, remainingParts.length);
  const displayParts = remainingParts.slice(-numToShow);
  return displayParts.join("/");
}

/**
 * Loads all projects from ~/.claude/projects/, parsing each .jsonl session file.
 * Returns projects sorted by most-recent session first.
 * Projects or sessions that fail to load are silently skipped.
 */
export function loadAllProjects(): ProjectListing[] {
  let projectDirEntries: string[];
  try {
    projectDirEntries = readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return [];
  }

  const projects: ProjectListing[] = [];

  for (const entry of projectDirEntries) {
    const entryPath = join(CLAUDE_PROJECTS_DIR, entry);

    let entryIsDirectory: boolean;
    try {
      entryIsDirectory = statSync(entryPath).isDirectory();
    } catch {
      continue;
    }

    if (!entryIsDirectory) continue;

    // Each project dir contains .jsonl files (sessions) and possibly subdirectories
    // (subagent files, memory). We only parse the root-level .jsonl files.
    let projectEntries: string[];
    try {
      projectEntries = readdirSync(entryPath);
    } catch {
      continue;
    }

    const jsonlFiles = projectEntries.filter(
      (name) => name.endsWith(".jsonl") && !name.includes("/")
    );

    if (jsonlFiles.length === 0) continue;

    const sessions: SessionListItem[] = [];

    for (const jsonlFile of jsonlFiles) {
      const filePath = join(entryPath, jsonlFile);
      const summary = loadSession(filePath);
      if (summary === null) continue;
      sessions.push(toSessionListItem(summary, filePath));
    }

    if (sessions.length === 0) continue;

    // Sort sessions by startedAt descending (most recent first)
    sessions.sort((sessionA, sessionB) => {
      const timeA = sessionA.startedAt ? new Date(sessionA.startedAt).getTime() : 0;
      const timeB = sessionB.startedAt ? new Date(sessionB.startedAt).getTime() : 0;
      return timeB - timeA;
    });

    const mostRecentSessionAt = sessions[0].startedAt;

    projects.push({
      slug: entry,
      displayName: slugToDisplayName(entry),
      sessions,
      mostRecentSessionAt,
    });
  }

  // Sort projects by most-recent session first
  projects.sort((projectA, projectB) => {
    const timeA = projectA.mostRecentSessionAt
      ? new Date(projectA.mostRecentSessionAt).getTime()
      : 0;
    const timeB = projectB.mostRecentSessionAt
      ? new Date(projectB.mostRecentSessionAt).getTime()
      : 0;
    return timeB - timeA;
  });

  return projects;
}
