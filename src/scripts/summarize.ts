/**
 * CLI script: print a turn-by-turn text summary of a Claude Code session JSONL file.
 *
 * Usage: npm run summarize -- <path-to-jsonl>
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { parseSessionJsonl } from "../parser/index.js";
import type { Turn, ContentBlock } from "../model.js";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npm run summarize -- <path-to-jsonl>");
  process.exit(1);
}

const filePath = resolve(args[0]);
let jsonlText: string;
try {
  jsonlText = readFileSync(filePath, "utf-8");
} catch (err) {
  console.error(`Error reading file: ${filePath}`);
  console.error(err);
  process.exit(1);
}

const summary = parseSessionJsonl(jsonlText);

// ---------------------------------------------------------------------------
// Print header
// ---------------------------------------------------------------------------
console.log("=".repeat(72));
console.log(`SESSION: ${summary.sessionId}`);
if (summary.aiTitle) {
  console.log(`TITLE:   ${summary.aiTitle}`);
}
if (summary.startedAt) {
  const startDate = new Date(summary.startedAt).toLocaleString();
  const durationSec = summary.durationMs
    ? `  (${(summary.durationMs / 1000).toFixed(0)}s)`
    : "";
  console.log(`STARTED: ${startDate}${durationSec}`);
}
const { totalUsage } = summary;
console.log(
  `TOKENS:  input=${totalUsage.inputTokens} output=${totalUsage.outputTokens} ` +
    `cache_read=${totalUsage.cacheReadInputTokens} cache_create=${totalUsage.cacheCreationInputTokens}`
);
if (summary.modelsUsed.length > 0) {
  console.log(`MODELS:  ${summary.modelsUsed.join(", ")}`);
}
console.log(`TURNS:   ${summary.turns.length} total`);
if (summary.unknownEvents.length > 0) {
  console.log(`UNKNOWN EVENTS: ${summary.unknownEvents.length} (unrecognized line types)`);
}
console.log("=".repeat(72));
console.log();

// ---------------------------------------------------------------------------
// Filter to non-meta turns for the summary
// ---------------------------------------------------------------------------
const nonMetaTurns = summary.turns.filter((t) => !t.isMeta);
const metaCount = summary.turns.length - nonMetaTurns.length;
if (metaCount > 0) {
  console.log(`(${metaCount} meta/system turns omitted)\n`);
}

if (nonMetaTurns.length === 0) {
  console.log("No conversation turns found.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Print each turn
// ---------------------------------------------------------------------------
for (const turn of nonMetaTurns) {
  const turnLabel = `TURN ${turn.turnIndex + 1}`;
  const timeLabel = turn.timestamp
    ? `  [${new Date(turn.timestamp).toLocaleTimeString()}]`
    : "";
  const durationLabel = turn.durationMs
    ? `  (${(turn.durationMs / 1000).toFixed(1)}s)`
    : "";
  const sidechainLabel = turn.isSidechain ? "  [SIDECHAIN]" : "";

  console.log("-".repeat(72));
  console.log(
    `${turnLabel}${timeLabel}${durationLabel}${sidechainLabel}  model=${turn.model ?? "?"}`
  );

  // User message
  if (turn.userText) {
    const truncated =
      turn.userText.length > 200
        ? turn.userText.slice(0, 200) + "…"
        : turn.userText;
    console.log(`  USER: ${truncated}`);
  }

  // Token usage
  if (turn.usage) {
    const u = turn.usage;
    console.log(
      `  USAGE: in=${u.inputTokens} out=${u.outputTokens} ` +
        `cache_read=${u.cacheReadInputTokens} cache_create=${u.cacheCreationInputTokens}`
    );
  }

  // Assistant content blocks
  const thinkingBlocks = turn.assistantBlocks.filter((b) => b.type === "thinking");
  const textBlocks = turn.assistantBlocks.filter((b) => b.type === "text");
  const toolUseBlocks = turn.assistantBlocks.filter((b) => b.type === "tool_use");

  if (thinkingBlocks.length > 0) {
    console.log(`  THINKING: [${thinkingBlocks.length} block(s) — collapsed]`);
  }

  for (const block of textBlocks) {
    if (block.type !== "text") continue;
    const truncated =
      block.text.length > 300 ? block.text.slice(0, 300) + "…" : block.text;
    console.log(`  ASSISTANT: ${truncated}`);
  }

  // Tool calls
  for (const toolCall of turn.toolCalls) {
    const inputSummary = formatToolInput(toolCall.input);
    const resultSummary = toolCall.result
      ? `→ ${toolCall.result.slice(0, 100).replace(/\n/g, " ")}${toolCall.result.length > 100 ? "…" : ""}`
      : toolCall.subagentId
        ? `→ [subagent: ${toolCall.subagentId}]`
        : "→ [no result]";
    const errorMark = toolCall.isError ? " [ERROR]" : "";
    console.log(`  TOOL ${toolCall.name}(${inputSummary})${errorMark}`);
    console.log(`       ${resultSummary}`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Unknown events summary
// ---------------------------------------------------------------------------
if (summary.unknownEvents.length > 0) {
  console.log("=".repeat(72));
  console.log(`UNKNOWN LINE TYPES:`);
  const typeCounts = new Map<string, number>();
  for (const ev of summary.unknownEvents) {
    typeCounts.set(ev.rawType, (typeCounts.get(ev.rawType) ?? 0) + 1);
  }
  for (const [rawType, count] of typeCounts) {
    console.log(`  ${rawType}: ${count} line(s)`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatToolInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  if (keys.length === 1) {
    const value = String(input[keys[0]] ?? "");
    const truncated =
      value.length > 60 ? value.slice(0, 60) + "…" : value;
    return `${keys[0]}=${JSON.stringify(truncated)}`;
  }
  return keys
    .slice(0, 3)
    .map((k) => {
      const value = String(input[k] ?? "");
      return `${k}=${JSON.stringify(value.length > 30 ? value.slice(0, 30) + "…" : value)}`;
    })
    .join(", ");
}
