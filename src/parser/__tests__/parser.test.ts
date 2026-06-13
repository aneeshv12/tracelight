/**
 * Parser snapshot tests against fixture files.
 *
 * These tests are the primary safety net for the parser:
 * - Validate that known line types produce correct Turn shapes.
 * - Validate that unrecognized lines become UnknownEvent entries (never crash, never drop).
 * - Validate tool-call/result pairing.
 * - Validate subagent spawn detection.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseSessionJsonl } from "../index.js";
import type { SessionSummary, Turn, ToolCall } from "../../model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../../../fixtures");

function loadFixture(filename: string): string {
  return readFileSync(resolve(fixturesDir, filename), "utf-8");
}

// ---------------------------------------------------------------------------
// Fixture 1: meta-only session (only slash-command lines, no assistant messages)
// ---------------------------------------------------------------------------

describe("fixture-01-meta-only", () => {
  let summary: SessionSummary;

  it("parses without throwing", () => {
    const jsonl = loadFixture("fixture-01-meta-only.jsonl");
    summary = parseSessionJsonl(jsonl);
  });

  it("captures sessionId", () => {
    expect(summary.sessionId).toBe("fixture-session-0001");
  });

  it("produces turns for user message lines", () => {
    // Two promptIds in the fixture → two turns
    expect(summary.turns.length).toBe(2);
  });

  it("marks both turns as meta", () => {
    for (const turn of summary.turns) {
      expect(turn.isMeta).toBe(true);
    }
  });

  it("produces no assistant blocks", () => {
    for (const turn of summary.turns) {
      expect(turn.assistantBlocks.length).toBe(0);
    }
  });

  it("produces zero unknown events for known line types", () => {
    expect(summary.unknownEvents.length).toBe(0);
  });

  it("produces zero total tokens (no assistant messages)", () => {
    expect(summary.totalUsage.outputTokens).toBe(0);
    expect(summary.totalUsage.inputTokens).toBe(0);
  });

  it("has no ai-title (not present in this fixture)", () => {
    expect(summary.aiTitle).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fixture 2: session with tool calls and file edits
// ---------------------------------------------------------------------------

describe("fixture-02-tool-calls", () => {
  let summary: SessionSummary;

  it("parses without throwing", () => {
    const jsonl = loadFixture("fixture-02-tool-calls.jsonl");
    summary = parseSessionJsonl(jsonl);
  });

  it("captures sessionId", () => {
    expect(summary.sessionId).toBe("fixture-session-0002");
  });

  it("captures ai-title", () => {
    expect(summary.aiTitle).toBe("Read config file");
  });

  it("produces two non-meta turns (one per promptId)", () => {
    const nonMeta = summary.turns.filter((t) => !t.isMeta);
    expect(nonMeta.length).toBe(2);
  });

  it("first turn has correct user text", () => {
    const nonMeta = summary.turns.filter((t) => !t.isMeta);
    expect(nonMeta[0].userText).toBe("What is in the config file?");
  });

  it("first turn merges streaming assistant lines into one set of blocks", () => {
    const nonMeta = summary.turns.filter((t) => !t.isMeta);
    const firstTurn = nonMeta[0];
    // The fixture has three assistant lines with the same msg-api-001 id:
    // one thinking block, one text block, one tool_use block
    const blockTypes = firstTurn.assistantBlocks.map((b) => b.type);
    expect(blockTypes).toContain("thinking");
    expect(blockTypes).toContain("text");
    expect(blockTypes).toContain("tool_use");
  });

  it("first turn has one ToolCall with result populated", () => {
    const nonMeta = summary.turns.filter((t) => !t.isMeta);
    const firstTurn = nonMeta[0];
    expect(firstTurn.toolCalls.length).toBe(1);
    const toolCall: ToolCall = firstTurn.toolCalls[0];
    expect(toolCall.name).toBe("Read");
    expect(toolCall.result).toContain("myproject");
    expect(toolCall.isError).toBe(false);
    expect(toolCall.subagentId).toBeUndefined();
  });

  it("second turn has Edit tool call with result", () => {
    const nonMeta = summary.turns.filter((t) => !t.isMeta);
    const secondTurn = nonMeta[1];
    expect(secondTurn.toolCalls.length).toBe(1);
    expect(secondTurn.toolCalls[0].name).toBe("Edit");
    expect(secondTurn.toolCalls[0].result).toContain("updated successfully");
  });

  it("aggregates token usage across turns", () => {
    // First turn uses msg-api-001 (100 in) and msg-api-002 (150 in)
    // Second turn uses msg-api-003 (200 in) and msg-api-004 (220 in)
    // Only first line per message-id should be counted for usage
    expect(summary.totalUsage.inputTokens).toBeGreaterThan(0);
    expect(summary.totalUsage.outputTokens).toBeGreaterThan(0);
  });

  it("records correct model", () => {
    expect(summary.modelsUsed).toContain("claude-sonnet-4-6");
  });

  it("patches durationMs from turn_duration system lines", () => {
    const nonMeta = summary.turns.filter((t) => !t.isMeta);
    // Both turns should have durationMs = 3000 from their turn_duration lines
    for (const turn of nonMeta) {
      expect(turn.durationMs).toBe(3000);
    }
  });

  it("has zero unknown events", () => {
    expect(summary.unknownEvents.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture 3: session with subagent spawn and one unknown line type
// ---------------------------------------------------------------------------

describe("fixture-03-subagent", () => {
  let summary: SessionSummary;

  it("parses without throwing", () => {
    const jsonl = loadFixture("fixture-03-subagent.jsonl");
    summary = parseSessionJsonl(jsonl);
  });

  it("detects Agent tool call", () => {
    const allToolCalls = summary.turns.flatMap((t) => t.toolCalls);
    const agentCall = allToolCalls.find((tc) => tc.name === "Agent");
    expect(agentCall).toBeDefined();
  });

  it("populates subagentId from toolUseResult.agentId", () => {
    const allToolCalls = summary.turns.flatMap((t) => t.toolCalls);
    const agentCall = allToolCalls.find((tc) => tc.name === "Agent");
    expect(agentCall?.subagentId).toBe("agent-sub-001");
  });

  it("records exactly one unknown event for the unrecognized line type", () => {
    expect(summary.unknownEvents.length).toBe(1);
    expect(summary.unknownEvents[0].rawType).toBe("unknown-future-line-type");
  });

  it("does not crash on the unknown line", () => {
    // The session should still have turns despite the unknown line
    expect(summary.turns.length).toBeGreaterThan(0);
  });

  it("captures ai-title", () => {
    expect(summary.aiTitle).toBe("Research task delegated to subagent");
  });
});

// ---------------------------------------------------------------------------
// Edge-case unit tests (small inline fixtures)
// ---------------------------------------------------------------------------

describe("parser edge cases", () => {
  it("handles empty input without throwing", () => {
    const result = parseSessionJsonl("");
    expect(result.turns.length).toBe(0);
    expect(result.unknownEvents.length).toBe(0);
  });

  it("handles malformed JSON lines gracefully as UnknownEvent", () => {
    const input = '{"type":"user","promptId":"p1","message":{"role":"user","content":"hello"},"uuid":"u1","sessionId":"s1"}\nnot-valid-json\n';
    const result = parseSessionJsonl(input);
    expect(result.unknownEvents.length).toBe(1);
    expect(result.unknownEvents[0].rawType).toBe("<json-parse-error>");
    // The valid user turn should still be parsed
    expect(result.turns.length).toBe(1);
  });

  it("handles assistant line before user line (out-of-order)", () => {
    const input = [
      JSON.stringify({ type: "assistant", promptId: "p1", isSidechain: false, uuid: "u2", timestamp: "2026-01-01T00:00:01Z", message: { id: "msg1", model: "claude-sonnet-4-6", role: "assistant", content: [{ type: "text", text: "Hello" }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }, sessionId: "s1" }),
      JSON.stringify({ type: "user", promptId: "p1", isSidechain: false, uuid: "u1", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "Hi" }, sessionId: "s1" }),
    ].join("\n");
    const result = parseSessionJsonl(input);
    expect(result.turns.length).toBe(1);
    expect(result.turns[0].assistantBlocks.length).toBe(1);
    expect(result.turns[0].userText).toBe("Hi");
  });

  it("strips XML wrappers from user text", () => {
    const input = JSON.stringify({
      type: "user",
      promptId: "p1",
      isSidechain: false,
      uuid: "u1",
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "<local-command-caveat>Caveat text</local-command-caveat>" },
      sessionId: "s1",
    });
    const result = parseSessionJsonl(input);
    expect(result.turns[0].userText).toBeUndefined();
  });

  it("does not duplicate usage when multiple assistant lines share same message id", () => {
    const sharedUsage = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const makeAssistantLine = (content: object[]) =>
      JSON.stringify({
        type: "assistant",
        promptId: "p1",
        isSidechain: false,
        uuid: `u-${Math.random()}`,
        timestamp: "2026-01-01T00:00:01Z",
        message: { id: "shared-msg-id", model: "claude-sonnet-4-6", role: "assistant", content, usage: sharedUsage },
        sessionId: "s1",
      });
    const input = [
      makeAssistantLine([{ type: "text", text: "First chunk" }]),
      makeAssistantLine([{ type: "text", text: "Second chunk" }]),
    ].join("\n");
    const result = parseSessionJsonl(input);
    // Usage should only be counted once (from the first line with this message id)
    expect(result.totalUsage.inputTokens).toBe(100);
    expect(result.totalUsage.outputTokens).toBe(50);
  });
});
