/**
 * Hand-maintained cost table for Claude model families.
 *
 * IMPORTANT: These prices are hand-maintained and must be verified against
 * https://www.anthropic.com/pricing before using for billing or reporting.
 * Last verified: 2026-06-13.
 */

import type { TokenUsage } from "./model.js";

export interface ModelPricing {
  /** USD per 1 million input tokens */
  readonly inputPer1M: number;
  /** USD per 1 million output tokens */
  readonly outputPer1M: number;
  /** USD per 1 million cache-write tokens */
  readonly cacheWritePer1M: number;
  /** USD per 1 million cache-read tokens */
  readonly cacheReadPer1M: number;
}

/** Date this pricing table was last verified against Anthropic's public list prices. */
export const PRICING_AS_OF_DATE = "2026-06-13";

/**
 * Known model-family prefixes mapped to their public list prices (USD per 1M tokens).
 *
 * Real model ids look like "claude-sonnet-4-6-20250930"; we match by prefix so
 * versioned ids resolve correctly. Add new families here as they are released.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Opus 4.6 / 4.7 / 4.8 list prices. (Older opus 4.0/4.1 were higher; rare in transcripts.)
  "claude-opus": {
    inputPer1M: 5,
    outputPer1M: 25,
    cacheWritePer1M: 6.25,
    cacheReadPer1M: 0.5,
  },
  "claude-sonnet": {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheWritePer1M: 3.75,
    cacheReadPer1M: 0.3,
  },
  "claude-haiku": {
    inputPer1M: 1,
    outputPer1M: 5,
    cacheWritePer1M: 1.25,
    cacheReadPer1M: 0.1,
  },
  // Fable 5 (Mythos-tier) sits above Opus on price.
  "claude-fable": {
    inputPer1M: 10,
    outputPer1M: 50,
    cacheWritePer1M: 12.5,
    cacheReadPer1M: 1.0,
  },
};

/**
 * Finds the ModelPricing entry for a given model id by checking which known
 * prefix the id starts with. Returns undefined for unknown models (e.g. "<synthetic>").
 */
function findPricingForModel(modelId: string): ModelPricing | undefined {
  for (const prefix of Object.keys(MODEL_PRICING)) {
    if (modelId.startsWith(prefix)) {
      return MODEL_PRICING[prefix];
    }
  }
  return undefined;
}

/**
 * Estimates the cost in USD for a given model and token usage.
 *
 * Returns undefined for model ids that don't match any known prefix (e.g. "<synthetic>"),
 * so the UI can display "cost unavailable" rather than a misleading zero.
 */
export function estimateCostUsd(modelId: string, usage: TokenUsage): number | undefined {
  const pricing = findPricingForModel(modelId);
  if (pricing === undefined) {
    return undefined;
  }

  const tokensPerMillion = 1_000_000;

  return (
    (usage.inputTokens * pricing.inputPer1M) / tokensPerMillion +
    (usage.outputTokens * pricing.outputPer1M) / tokensPerMillion +
    (usage.cacheCreationInputTokens * pricing.cacheWritePer1M) / tokensPerMillion +
    (usage.cacheReadInputTokens * pricing.cacheReadPer1M) / tokensPerMillion
  );
}
