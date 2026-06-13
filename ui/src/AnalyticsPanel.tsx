import React from "react";
import type { SessionDetail, TurnJson, TokenUsageSummary } from "@shared/apiTypes";
import {
  formatTokens,
  formatDuration,
  formatUsd,
  sumTokenUsage,
  lookupModelPricing,
  estimateUsageCostUsd,
} from "./format";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function addUsage(accumulator: TokenUsageSummary, addition: TokenUsageSummary): TokenUsageSummary {
  return {
    inputTokens: accumulator.inputTokens + addition.inputTokens,
    outputTokens: accumulator.outputTokens + addition.outputTokens,
    cacheCreationInputTokens:
      accumulator.cacheCreationInputTokens + addition.cacheCreationInputTokens,
    cacheReadInputTokens: accumulator.cacheReadInputTokens + addition.cacheReadInputTokens,
  };
}

const EMPTY_USAGE: TokenUsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

/** Extract the first text snippet from a turn for display in tables. */
function turnSnippet(turn: TurnJson): string {
  if (turn.userText !== undefined && turn.userText.trim().length > 0) {
    return turn.userText.trim().slice(0, 60);
  }
  for (const block of turn.assistantBlocks) {
    if (block.type === "text" && block.text.trim().length > 0) {
      return block.text.trim().slice(0, 60);
    }
  }
  return "(no text)";
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h3 className="text-xs font-mono uppercase tracking-wider text-gray-500 mb-2">
      {children}
    </h3>
  );
}

function MonoCell({ children }: { children?: React.ReactNode }): React.ReactElement {
  return (
    <td className="py-1 pr-4 font-mono text-xs text-gray-300 text-right tabular-nums whitespace-nowrap">
      {children}
    </td>
  );
}

function LabelCell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <td className="py-1 pr-4 font-mono text-xs text-gray-400 truncate max-w-[200px]">
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Cost by model
// ---------------------------------------------------------------------------

interface ModelCostRow {
  modelId: string;
  usage: TokenUsageSummary;
  estimatedCostUsd: number | undefined;
}

function CostByModelSection({ session }: { session: SessionDetail }): React.ReactElement {
  const perModelUsage = new Map<string, TokenUsageSummary>();

  for (const turn of session.turns) {
    if (turn.usage === undefined || turn.model === undefined) continue;
    const existing = perModelUsage.get(turn.model) ?? { ...EMPTY_USAGE };
    perModelUsage.set(turn.model, addUsage(existing, turn.usage));
  }

  const rows: ModelCostRow[] = [];
  for (const [modelId, usage] of perModelUsage.entries()) {
    const pricingEntry = lookupModelPricing(modelId, session.pricing);
    const estimatedCostUsd =
      pricingEntry !== undefined ? estimateUsageCostUsd(usage, pricingEntry) : undefined;
    rows.push({ modelId, usage, estimatedCostUsd });
  }

  // Sort: models with cost first (descending), then no-pricing models
  rows.sort((rowA, rowB) => {
    if (rowA.estimatedCostUsd !== undefined && rowB.estimatedCostUsd !== undefined) {
      return rowB.estimatedCostUsd - rowA.estimatedCostUsd;
    }
    if (rowA.estimatedCostUsd !== undefined) return -1;
    if (rowB.estimatedCostUsd !== undefined) return 1;
    return rowA.modelId.localeCompare(rowB.modelId);
  });

  const totalEstimatedCostUsd = rows.reduce<number | undefined>((accumulator, row) => {
    if (row.estimatedCostUsd === undefined) return accumulator;
    return (accumulator ?? 0) + row.estimatedCostUsd;
  }, undefined);

  if (rows.length === 0) {
    return (
      <div>
        <SectionHeading>Cost by model</SectionHeading>
        <p className="text-xs text-gray-600 font-mono">No per-turn model data available.</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>Cost by model</SectionHeading>
      <table className="w-full">
        <tbody>
          {rows.map((row) => (
            <tr key={row.modelId} className="border-t border-gray-800 first:border-t-0">
              <LabelCell>{row.modelId.replace(/^claude-/, "")}</LabelCell>
              <MonoCell>{formatTokens(sumTokenUsage(row.usage))} tok</MonoCell>
              <MonoCell>
                {row.estimatedCostUsd !== undefined
                  ? formatUsd(row.estimatedCostUsd)
                  : <span className="text-gray-600">cost unavailable</span>}
              </MonoCell>
            </tr>
          ))}
          {totalEstimatedCostUsd !== undefined && (
            <tr className="border-t border-gray-700">
              <td className="py-1 pr-4 font-mono text-xs text-gray-500">total</td>
              <MonoCell></MonoCell>
              <MonoCell>
                <span className="text-gray-200 font-semibold">
                  {formatUsd(totalEstimatedCostUsd)}
                </span>
              </MonoCell>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-gray-700 font-mono mt-2">
        Prices as of {session.pricing.asOfDate} — estimates only
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool-call frequency
// ---------------------------------------------------------------------------

function ToolFrequencySection({ session }: { session: SessionDetail }): React.ReactElement {
  // Count tool calls from parent session turns only (spec says subagent counts optional)
  const toolCounts = new Map<string, number>();
  for (const turn of session.turns) {
    for (const toolCall of turn.toolCalls) {
      toolCounts.set(toolCall.name, (toolCounts.get(toolCall.name) ?? 0) + 1);
    }
  }

  const sortedTools = [...toolCounts.entries()].sort(([, countA], [, countB]) => countB - countA);

  if (sortedTools.length === 0) {
    return (
      <div>
        <SectionHeading>Tool-call frequency</SectionHeading>
        <p className="text-xs text-gray-600 font-mono">No tool calls in this session.</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>Tool-call frequency (parent session)</SectionHeading>
      <table className="w-full">
        <tbody>
          {sortedTools.map(([toolName, count]) => (
            <tr key={toolName} className="border-t border-gray-800 first:border-t-0">
              <LabelCell>{toolName}</LabelCell>
              <MonoCell>{count}</MonoCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token breakdown
// ---------------------------------------------------------------------------

function TokenBreakdownSection({ session }: { session: SessionDetail }): React.ReactElement {
  const usage = session.totalUsage;
  return (
    <div>
      <SectionHeading>Token breakdown (session total)</SectionHeading>
      <table className="w-full">
        <tbody>
          <tr className="border-t border-gray-800 first:border-t-0">
            <LabelCell>input</LabelCell>
            <MonoCell>{formatTokens(usage.inputTokens)}</MonoCell>
          </tr>
          <tr className="border-t border-gray-800">
            <LabelCell>output</LabelCell>
            <MonoCell>{formatTokens(usage.outputTokens)}</MonoCell>
          </tr>
          <tr className="border-t border-gray-800">
            <LabelCell>cache write</LabelCell>
            <MonoCell>{formatTokens(usage.cacheCreationInputTokens)}</MonoCell>
          </tr>
          <tr className="border-t border-gray-800">
            <LabelCell>cache read</LabelCell>
            <MonoCell>{formatTokens(usage.cacheReadInputTokens)}</MonoCell>
          </tr>
          <tr className="border-t border-gray-700">
            <td className="py-1 pr-4 font-mono text-xs text-gray-500">total</td>
            <MonoCell>
              <span className="text-gray-200 font-semibold">
                {formatTokens(sumTokenUsage(usage))}
              </span>
            </MonoCell>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top turns by duration / cost
// ---------------------------------------------------------------------------

const TOP_TURN_COUNT = 5;

interface TurnDurationRow {
  turn: TurnJson;
  durationMs: number;
}

interface TurnCostRow {
  turn: TurnJson;
  estimatedCostUsd: number;
  modelId: string;
}

function LongestTurnsSection({ session }: { session: SessionDetail }): React.ReactElement {
  const turnsWithDuration: TurnDurationRow[] = session.turns
    .filter((turn): turn is TurnJson & { durationMs: number } => turn.durationMs !== undefined)
    .map((turn) => ({ turn, durationMs: turn.durationMs }));

  turnsWithDuration.sort((rowA, rowB) => rowB.durationMs - rowA.durationMs);
  const topRows = turnsWithDuration.slice(0, TOP_TURN_COUNT);

  if (topRows.length === 0) {
    return (
      <div>
        <SectionHeading>Longest turns (top {TOP_TURN_COUNT})</SectionHeading>
        <p className="text-xs text-gray-600 font-mono">No duration data available.</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>Longest turns (top {TOP_TURN_COUNT})</SectionHeading>
      <table className="w-full">
        <tbody>
          {topRows.map(({ turn, durationMs }) => (
            <tr key={turn.turnIndex} className="border-t border-gray-800 first:border-t-0">
              <td className="py-1 pr-2 font-mono text-xs text-gray-600 shrink-0 whitespace-nowrap">
                #{turn.turnIndex}
              </td>
              <LabelCell>{turnSnippet(turn)}</LabelCell>
              <MonoCell>{formatDuration(durationMs)}</MonoCell>
              <td className="py-1 font-mono text-xs text-gray-600 truncate max-w-[120px]">
                {turn.model !== undefined ? turn.model.replace(/^claude-/, "") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MostExpensiveTurnsSection({ session }: { session: SessionDetail }): React.ReactElement {
  const turnsWithCost: TurnCostRow[] = [];

  for (const turn of session.turns) {
    if (turn.usage === undefined || turn.model === undefined) continue;
    const pricingEntry = lookupModelPricing(turn.model, session.pricing);
    if (pricingEntry === undefined) continue;
    const estimatedCostUsd = estimateUsageCostUsd(turn.usage, pricingEntry);
    turnsWithCost.push({ turn, estimatedCostUsd, modelId: turn.model });
  }

  turnsWithCost.sort((rowA, rowB) => rowB.estimatedCostUsd - rowA.estimatedCostUsd);
  const topRows = turnsWithCost.slice(0, TOP_TURN_COUNT);

  if (topRows.length === 0) {
    return (
      <div>
        <SectionHeading>Most expensive turns (top {TOP_TURN_COUNT})</SectionHeading>
        <p className="text-xs text-gray-600 font-mono">No cost data available.</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>Most expensive turns (top {TOP_TURN_COUNT})</SectionHeading>
      <table className="w-full">
        <tbody>
          {topRows.map(({ turn, estimatedCostUsd, modelId }) => (
            <tr key={turn.turnIndex} className="border-t border-gray-800 first:border-t-0">
              <td className="py-1 pr-2 font-mono text-xs text-gray-600 shrink-0 whitespace-nowrap">
                #{turn.turnIndex}
              </td>
              <LabelCell>{turnSnippet(turn)}</LabelCell>
              <MonoCell>{formatUsd(estimatedCostUsd)}</MonoCell>
              <td className="py-1 font-mono text-xs text-gray-600 truncate max-w-[120px]">
                {modelId.replace(/^claude-/, "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function AnalyticsPanel({ session }: { session: SessionDetail }): React.ReactElement {
  return (
    <div className="flex flex-col gap-8 py-6">
      <CostByModelSection session={session} />
      <ToolFrequencySection session={session} />
      <TokenBreakdownSection session={session} />
      <LongestTurnsSection session={session} />
      <MostExpensiveTurnsSection session={session} />
    </div>
  );
}
