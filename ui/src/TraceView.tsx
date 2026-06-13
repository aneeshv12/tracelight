import React, { createContext, useContext, useEffect, useState } from "react";
import type {
  SessionDetail,
  SubagentTraceJson,
  TurnJson,
  ContentBlockJson,
  ToolCallJson,
  TextBlockJson,
  ThinkingBlockJson,
  ToolUseBlockJson,
} from "@shared/apiTypes";
import { formatDuration, formatTokens, sumTokenUsage } from "./format";
import { DiffView } from "./DiffView";
import { extractDiffData } from "./diffInput";
import { AnalyticsPanel } from "./AnalyticsPanel";

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  const response = await fetch(`/api/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch session: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<SessionDetail>;
}

// ---------------------------------------------------------------------------
// Subagent lookup context
//
// We build a single Map keyed by BOTH parentToolUseId and agentId so that
// ToolCallCard can look up by toolCall.id (which matches parentToolUseId) or
// fall back by toolCall.subagentId (which matches agentId).  The Map entries
// are set with both keys pointing at the same SubagentTraceJson object — the
// Map value is always the trace, never a secondary index.
// ---------------------------------------------------------------------------

const SubagentLookupContext = createContext<Map<string, SubagentTraceJson>>(new Map());

function buildSubagentLookup(subagents: SubagentTraceJson[]): Map<string, SubagentTraceJson> {
  const lookup = new Map<string, SubagentTraceJson>();
  for (const subagent of subagents) {
    // Primary key: the tool_use_id in the parent turn that spawned this agent
    if (subagent.parentToolUseId.length > 0) {
      lookup.set(subagent.parentToolUseId, subagent);
    }
    // Fallback key: the agentId itself (used when subagentId on the tool call matches)
    if (subagent.agentId.length > 0) {
      lookup.set(subagent.agentId, subagent);
    }
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// View tab type
// ---------------------------------------------------------------------------

type ActiveTab = "trace" | "analytics";

// ---------------------------------------------------------------------------
// Shared Chip (mirrors HomeView's Chip — duplicated to avoid cross-file prop coupling)
// ---------------------------------------------------------------------------

function Chip({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono ${
        muted ? "bg-gray-800 text-gray-500" : "bg-gray-800 text-gray-300"
      }`}
    >
      <span className="text-gray-500">{label}</span>
      <span>{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const RESULT_TRUNCATION_LENGTH = 1500;
const RESULT_TRUNCATION_LINES = 20;

function turnMatchesQuery(turn: TurnJson, query: string): boolean {
  const lowercaseQuery = query.toLowerCase();

  if (turn.userText?.toLowerCase().includes(lowercaseQuery)) return true;

  for (const block of turn.assistantBlocks) {
    if (block.type === "text" && block.text.toLowerCase().includes(lowercaseQuery)) {
      return true;
    }
    if (block.type === "thinking" && block.thinking.toLowerCase().includes(lowercaseQuery)) {
      return true;
    }
  }

  for (const toolCall of turn.toolCalls) {
    if (toolCall.name.toLowerCase().includes(lowercaseQuery)) return true;
    if (JSON.stringify(toolCall.input).toLowerCase().includes(lowercaseQuery)) return true;
    if (toolCall.result?.toLowerCase().includes(lowercaseQuery)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Content block rendering helpers
// ---------------------------------------------------------------------------

function truncateResult(result: string): { truncated: string; wasTruncated: boolean } {
  const lines = result.split("\n");
  const byLines = lines.slice(0, RESULT_TRUNCATION_LINES).join("\n");
  const byChars = result.slice(0, RESULT_TRUNCATION_LENGTH);

  // Use whichever boundary is shorter
  if (byLines.length <= byChars.length) {
    const wasTruncated = lines.length > RESULT_TRUNCATION_LINES;
    return { truncated: byLines, wasTruncated };
  } else {
    const wasTruncated = result.length > RESULT_TRUNCATION_LENGTH;
    return { truncated: byChars, wasTruncated };
  }
}

// ---------------------------------------------------------------------------
// Nested subagent mini-timeline
// ---------------------------------------------------------------------------

/**
 * Renders one subagent's turns as a compact, visually indented timeline.
 * Collapsed by default; expanding reveals the full subagent run.
 * Reuses AssistantBlockRenderer / TurnFooter for consistent block rendering.
 * Subagent tool calls are rendered without their own nested subagents (the
 * spec says nested-subagents don't happen in practice, and we pass an empty
 * lookup to avoid surprises).
 */
function SubagentMiniTimeline({
  subagent,
}: {
  subagent: SubagentTraceJson;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const emptyLookup = new Map<string, SubagentTraceJson>();

  return (
    <div className="mt-2 border-l-2 border-violet-800 pl-3">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 text-left w-full group"
      >
        <span className="font-mono text-xs rounded px-1 py-0.5 bg-violet-900 text-violet-300">
          subagent: {subagent.agentType}
        </span>
        {subagent.description.length > 0 && (
          <span className="text-xs text-gray-500 truncate flex-1 group-hover:text-gray-400 transition-colors">
            {subagent.description}
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-gray-700 shrink-0">
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {expanded && (
        <SubagentLookupContext.Provider value={emptyLookup}>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            {subagent.turns.length === 0 ? (
              <p className="text-xs text-gray-600 font-mono">No turns recorded for this subagent.</p>
            ) : (
              subagent.turns.map((turn) => (
                <SubagentTurnBlock key={turn.turnIndex} turn={turn} />
              ))
            )}
          </div>
        </SubagentLookupContext.Provider>
      )}
    </div>
  );
}

/**
 * Renders a single subagent turn with slightly smaller styling.
 * Mirrors NormalTurnBlock but without the outer card border (the
 * SubagentMiniTimeline container already provides visual grouping).
 */
function SubagentTurnBlock({ turn }: { turn: TurnJson }): React.ReactElement {
  const toolCallsById = new Map<string, ToolCallJson>(
    turn.toolCalls.map((toolCall) => [toolCall.id, toolCall])
  );

  const hasUserMessage = turn.userText !== undefined && turn.userText.trim().length > 0;
  const hasAssistantContent = turn.assistantBlocks.length > 0;

  if (!hasUserMessage && !hasAssistantContent) return <></>;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
      {hasUserMessage && (
        <div className="pl-2 border-l border-blue-700">
          <div className="text-xs text-blue-500 font-mono mb-0.5">You</div>
          <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed max-w-prose">
            {turn.userText}
          </p>
        </div>
      )}

      {hasAssistantContent && (
        <div className="flex flex-col gap-1.5">
          {turn.assistantBlocks.map((block, blockIndex) => (
            <AssistantBlockRenderer
              key={blockIndex}
              block={block}
              toolCallsById={toolCallsById}
            />
          ))}
        </div>
      )}

      <TurnFooter turn={turn} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallCard
// ---------------------------------------------------------------------------

function RawInputView({ input }: { input: Record<string, unknown> }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const inputJson = JSON.stringify(input, null, 2);
  const inputLines = inputJson.split("\n").length;
  const inputIsLong = inputLines > 20;
  const displayedInput =
    inputIsLong && !expanded
      ? inputJson.split("\n").slice(0, 20).join("\n") + "\n…"
      : inputJson;

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500 font-mono uppercase tracking-wide">input</span>
        {inputIsLong && (
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors font-mono"
          >
            {expanded ? "collapse ▴" : "expand ▾"}
          </button>
        )}
      </div>
      <pre className="text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
        {displayedInput}
      </pre>
    </div>
  );
}

function DiffInputView({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown>;
}): React.ReactElement {
  const diffData = extractDiffData(toolName, input);

  if (diffData === null) {
    // Shape didn't match — fall back to raw JSON so nothing is lost.
    return <RawInputView input={input} />;
  }

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="mb-1">
        <span className="text-xs text-gray-500 font-mono uppercase tracking-wide">diff</span>
      </div>
      <DiffView data={diffData} />
    </div>
  );
}

const EDIT_TOOL_NAMES = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

function ToolCallCard({ toolCall }: { toolCall: ToolCallJson }): React.ReactElement {
  const [resultExpanded, setResultExpanded] = useState(false);
  const subagentLookup = useContext(SubagentLookupContext);

  const isEditTool = EDIT_TOOL_NAMES.has(toolCall.name);

  const hasResult = toolCall.result !== undefined;
  let displayedResult = "";
  let resultWasTruncated = false;

  if (hasResult && toolCall.result !== undefined) {
    const { truncated, wasTruncated } = truncateResult(toolCall.result);
    displayedResult = truncated;
    resultWasTruncated = wasTruncated;
  }

  // Look up the subagent: prefer parentToolUseId match (toolCall.id), then agentId match
  const linkedSubagent: SubagentTraceJson | undefined =
    toolCall.subagentId !== undefined
      ? (subagentLookup.get(toolCall.id) ?? subagentLookup.get(toolCall.subagentId))
      : undefined;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
      {/* Tool header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="font-mono text-sm text-amber-300 font-semibold">
          {toolCall.name}
        </span>
        {toolCall.isError && (
          <span className="rounded px-1.5 py-0.5 text-xs bg-red-900 text-red-300 font-mono">
            error
          </span>
        )}
        {toolCall.subagentId !== undefined && linkedSubagent === undefined && (
          <span className="ml-auto text-xs text-gray-600 font-mono">
            subagent: {toolCall.subagentId.slice(0, 8)} (no trace)
          </span>
        )}
      </div>

      {/* Input section: diff view for edit tools, raw JSON for everything else */}
      {isEditTool ? (
        <DiffInputView toolName={toolCall.name} input={toolCall.input} />
      ) : (
        <RawInputView input={toolCall.input} />
      )}

      {/* Nested subagent mini-timeline — shown only when a trace was found */}
      {linkedSubagent !== undefined && (
        <div className="px-3 pb-2 border-t border-gray-800 mt-1">
          <SubagentMiniTimeline subagent={linkedSubagent} />
        </div>
      )}

      {/* Result section */}
      {hasResult && (
        <div className="px-3 pt-1 pb-2 border-t border-gray-800 mt-1">
          <div className="flex items-center justify-between mb-1">
            <span
              className={`text-xs font-mono uppercase tracking-wide ${
                toolCall.isError ? "text-red-400" : "text-gray-500"
              }`}
            >
              result
            </span>
            {(resultWasTruncated || resultExpanded) && (
              <button
                onClick={() => setResultExpanded((prev) => !prev)}
                className="text-xs text-gray-400 hover:text-gray-200 transition-colors font-mono"
              >
                {resultExpanded ? "collapse ▴" : "expand ▾"}
              </button>
            )}
          </div>
          <pre
            className={`text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words leading-relaxed ${
              toolCall.isError ? "text-red-300" : "text-gray-300"
            }`}
          >
            {resultExpanded ? toolCall.result : displayedResult}
          </pre>
          {resultWasTruncated && !resultExpanded && (
            <div className="text-xs text-gray-600 mt-1">
              … truncated ({toolCall.result?.length.toLocaleString()} chars total)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block renderers
// ---------------------------------------------------------------------------

function TextBlockRenderer({ block }: { block: TextBlockJson }): React.ReactElement {
  if (!block.text.trim()) return <></>;
  return (
    <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed max-w-prose">
      {block.text}
    </p>
  );
}

function ThinkingBlockRenderer({ block }: { block: ThinkingBlockJson }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors font-mono"
      >
        <span>{expanded ? "thinking ▴" : "thinking ▸"}</span>
      </button>
      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-gray-700">
          <p className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed max-w-prose">
            {block.thinking}
          </p>
        </div>
      )}
    </div>
  );
}

function ToolUseBlockRenderer({
  block,
  toolCallsById,
}: {
  block: ToolUseBlockJson;
  toolCallsById: Map<string, ToolCallJson>;
}): React.ReactElement {
  const toolCall = toolCallsById.get(block.id);

  if (toolCall === undefined) {
    // Defensive: tool_use block with no matching ToolCallJson
    return (
      <div className="rounded border border-gray-700 bg-gray-900 px-3 py-2">
        <span className="font-mono text-xs text-gray-500">
          tool_use: {block.name} (no result data)
        </span>
      </div>
    );
  }

  return <ToolCallCard toolCall={toolCall} />;
}

function AssistantBlockRenderer({
  block,
  toolCallsById,
}: {
  block: ContentBlockJson;
  toolCallsById: Map<string, ToolCallJson>;
}): React.ReactElement {
  if (block.type === "text") {
    return <TextBlockRenderer block={block} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlockRenderer block={block} />;
  }
  if (block.type === "tool_use") {
    return <ToolUseBlockRenderer block={block} toolCallsById={toolCallsById} />;
  }
  if (block.type === "tool_result") {
    // tool_result blocks should not appear in assistantBlocks per spec,
    // but handle defensively rather than crashing.
    return (
      <div className="rounded border border-gray-700 bg-gray-900 px-3 py-2">
        <span className="font-mono text-xs text-gray-500">
          tool_result (unexpected position — skipped)
        </span>
      </div>
    );
  }
  // Exhaustiveness: TypeScript should catch this, but guard at runtime too.
  return <></>;
}

// ---------------------------------------------------------------------------
// TurnBlock
// ---------------------------------------------------------------------------

function TurnFooter({ turn }: { turn: TurnJson }): React.ReactElement | null {
  const hasAnyFooterData = turn.model !== undefined || turn.usage !== undefined || turn.durationMs !== undefined;
  if (!hasAnyFooterData) return null;

  const tokenCount = turn.usage !== undefined ? sumTokenUsage(turn.usage) : undefined;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-800">
      {turn.model !== undefined && (
        <Chip label="model" value={turn.model.replace(/^claude-/, "")} muted />
      )}
      {tokenCount !== undefined && (
        <Chip label="tokens" value={formatTokens(tokenCount)} muted />
      )}
      {turn.durationMs !== undefined && (
        <Chip label="dur" value={formatDuration(turn.durationMs)} muted />
      )}
    </div>
  );
}

function NormalTurnBlock({ turn }: { turn: TurnJson }): React.ReactElement {
  const toolCallsById = new Map<string, ToolCallJson>(
    turn.toolCalls.map((toolCall) => [toolCall.id, toolCall])
  );

  const hasUserMessage = turn.userText !== undefined && turn.userText.trim().length > 0;
  const hasAssistantContent = turn.assistantBlocks.length > 0;

  if (!hasUserMessage && !hasAssistantContent) return <></>;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
      {hasUserMessage && (
        <div className="pl-3 border-l-2 border-blue-600">
          <div className="text-xs text-blue-400 font-mono mb-1">You</div>
          <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed max-w-prose">
            {turn.userText}
          </p>
        </div>
      )}

      {hasAssistantContent && (
        <div className="flex flex-col gap-2">
          {turn.assistantBlocks.map((block, blockIndex) => (
            <AssistantBlockRenderer
              key={blockIndex}
              block={block}
              toolCallsById={toolCallsById}
            />
          ))}
        </div>
      )}

      <TurnFooter turn={turn} />
    </div>
  );
}

function MetaOrSidechainTurnBlock({ turn }: { turn: TurnJson }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const label = turn.isMeta ? "meta" : "sidechain";
  const previewText = turn.userText ?? (
    turn.assistantBlocks.length > 0 && turn.assistantBlocks[0].type === "text"
      ? turn.assistantBlocks[0].text.slice(0, 80)
      : undefined
  );

  const toolCallsById = new Map<string, ToolCallJson>(
    turn.toolCalls.map((toolCall) => [toolCall.id, toolCall])
  );

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 text-gray-500">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:text-gray-400 transition-colors"
      >
        <span className="font-mono text-xs rounded px-1 py-0.5 bg-gray-800 text-gray-600">
          {label}
        </span>
        {!expanded && previewText !== undefined && (
          <span className="text-xs text-gray-600 truncate flex-1">
            {previewText}
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-gray-700 shrink-0">
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 flex flex-col gap-2 border-t border-gray-800">
          {turn.userText !== undefined && turn.userText.trim().length > 0 && (
            <div className="pl-3 border-l border-gray-700 mt-2">
              <div className="text-xs text-gray-600 font-mono mb-1">You</div>
              <p className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed max-w-prose">
                {turn.userText}
              </p>
            </div>
          )}
          {turn.assistantBlocks.length > 0 && (
            <div className="flex flex-col gap-2 mt-1 opacity-70">
              {turn.assistantBlocks.map((block, blockIndex) => (
                <AssistantBlockRenderer
                  key={blockIndex}
                  block={block}
                  toolCallsById={toolCallsById}
                />
              ))}
            </div>
          )}
          <TurnFooter turn={turn} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TurnRenderer — routes to normal or meta/sidechain block
// ---------------------------------------------------------------------------

function TurnRenderer({ turn }: { turn: TurnJson }): React.ReactElement {
  if (turn.isMeta || turn.isSidechain) {
    return <MetaOrSidechainTurnBlock turn={turn} />;
  }
  return <NormalTurnBlock turn={turn} />;
}

// ---------------------------------------------------------------------------
// TraceHeader — sticky header with back, title, chips, tab toggle, search
// ---------------------------------------------------------------------------

function TraceHeader({
  title,
  onBack,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  chipTurnCount,
  chipDuration,
  chipTokens,
}: {
  title: string;
  onBack: () => void;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  chipTurnCount?: string;
  chipDuration?: string;
  chipTokens?: string;
}): React.ReactElement {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur-sm px-6 py-3">
      <div className="mx-auto max-w-4xl flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white transition-colors text-sm font-mono shrink-0"
          >
            &larr; Back
          </button>
          <span className="text-sm font-semibold text-white truncate flex-1">
            {title}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {chipTurnCount !== undefined && (
              <Chip label="turns" value={chipTurnCount} />
            )}
            {chipDuration !== undefined && (
              <Chip label="dur" value={chipDuration} />
            )}
            {chipTokens !== undefined && (
              <Chip label="tokens" value={chipTokens} />
            )}
          </div>
        </div>

        {/* Tab toggle */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onTabChange("trace")}
            className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
              activeTab === "trace"
                ? "bg-gray-700 text-gray-100"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Trace
          </button>
          <button
            onClick={() => onTabChange("analytics")}
            className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
              activeTab === "analytics"
                ? "bg-gray-700 text-gray-100"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Analytics
          </button>
        </div>

        {/* Search input — only shown in trace tab */}
        {activeTab === "trace" && (
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search turns…"
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:border-gray-500 focus:outline-none transition-colors font-mono"
          />
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Main TraceView
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; session: SessionDetail };

export function TraceView({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}): React.ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("trace");

  useEffect(() => {
    setLoadState({ status: "loading" });
    fetchSessionDetail(sessionId)
      .then((session) => setLoadState({ status: "loaded", session }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setLoadState({ status: "error", message });
      });
  }, [sessionId]);

  if (loadState.status === "loading") {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <TraceHeader
          title="Loading…"
          onBack={onBack}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        <main className="mx-auto max-w-4xl px-6 py-8">
          <div className="text-gray-400 text-sm animate-pulse">
            Loading session…
          </div>
        </main>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <TraceHeader
          title="Error"
          onBack={onBack}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        <main className="mx-auto max-w-4xl px-6 py-8">
          <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300">
            <strong>Failed to load session:</strong> {loadState.message}
          </div>
        </main>
      </div>
    );
  }

  const { session } = loadState;
  const trimmedQuery = searchQuery.trim();

  const visibleTurns = trimmedQuery.length === 0
    ? session.turns
    : session.turns.filter((turn) => turnMatchesQuery(turn, trimmedQuery));

  const totalTokens = sumTokenUsage(session.totalUsage);
  const sessionTitle = session.aiTitle ?? (sessionId.slice(0, 8) + "…");

  // Build the subagent lookup once per session load, at the top level.
  // Both parentToolUseId and agentId are indexed so ToolCallCard can find
  // traces regardless of which identifier a tool call carries.
  const subagentLookup = buildSubagentLookup(session.subagents);

  return (
    <SubagentLookupContext.Provider value={subagentLookup}>
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <TraceHeader
          title={sessionTitle}
          onBack={onBack}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          chipTurnCount={String(session.turnCount)}
          chipDuration={formatDuration(session.durationMs)}
          chipTokens={formatTokens(totalTokens)}
        />

        <main className="mx-auto max-w-4xl px-6 py-6">
          {activeTab === "analytics" ? (
            <AnalyticsPanel session={session} />
          ) : (
            <>
              {session.unknownEventCount > 0 && (
                <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-950 px-4 py-3 text-xs text-yellow-300">
                  {session.unknownEventCount} unrecognized event{session.unknownEventCount !== 1 ? "s" : ""} in this session (format undocumented; rendering skipped).
                </div>
              )}

              {trimmedQuery.length > 0 && (
                <div className="mb-4 text-xs text-gray-500">
                  showing {visibleTurns.length} of {session.turns.length} turns
                </div>
              )}

              <div className="flex flex-col gap-3">
                {visibleTurns.map((turn) => (
                  <TurnRenderer key={turn.turnIndex} turn={turn} />
                ))}
              </div>

              {visibleTurns.length === 0 && trimmedQuery.length === 0 && (
                <div className="text-gray-500 text-sm text-center py-12">
                  This session has no readable turns.
                </div>
              )}

              {visibleTurns.length === 0 && trimmedQuery.length > 0 && (
                <div className="text-gray-500 text-sm text-center py-12">
                  No turns match "{trimmedQuery}"
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </SubagentLookupContext.Provider>
  );
}
