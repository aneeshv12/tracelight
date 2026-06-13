import type { ModelPricingJson, PricingTableJson, TokenUsageSummary } from "@shared/apiTypes";

export function formatDate(isoString: string | undefined): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "—";
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return String(count);
}

export function sumTokenUsage(usage: TokenUsageSummary): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens
  );
}

/**
 * Prefix-match a full model id against pricing table keys.
 * Real ids look like "claude-sonnet-4-6-20250930"; table keys look like "claude-sonnet".
 * We find the longest key that is a prefix of the model id, to prefer the most specific match.
 */
export function lookupModelPricing(
  modelId: string,
  pricingTable: PricingTableJson
): ModelPricingJson | undefined {
  let bestKey: string | undefined;
  for (const key of Object.keys(pricingTable.models)) {
    if (modelId.startsWith(key)) {
      if (bestKey === undefined || key.length > bestKey.length) {
        bestKey = key;
      }
    }
  }
  return bestKey !== undefined ? pricingTable.models[bestKey] : undefined;
}

/**
 * Estimate USD cost for a single TokenUsageSummary given a pricing entry.
 * Returns undefined if pricing is missing.
 */
export function estimateUsageCostUsd(
  usage: TokenUsageSummary,
  pricing: ModelPricingJson
): number {
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
  const cacheWriteCost = (usage.cacheCreationInputTokens / 1_000_000) * pricing.cacheWritePer1M;
  const cacheReadCost = (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheReadPer1M;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export function formatUsd(amount: number): string {
  if (amount < 0.001) return `$${amount.toFixed(5)}`;
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
