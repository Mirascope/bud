import { ModelInfo, type ModelPricing } from "../model-info/model-info.ts";
import type { TokenUsage, ToolUsage } from "../responses/usage.ts";
import { Pricing, type PricingService } from "./pricing.ts";
import { Effect, Layer } from "effect";

function tokenCost(
  count: number,
  centicentsPerMillionTokens: number | undefined,
): number {
  return (count * (centicentsPerMillionTokens ?? 0)) / 1_000_000;
}

export function calculateTokenCostCenticents(
  tokens: TokenUsage,
  pricing: ModelPricing | undefined,
): number {
  return (
    tokenCost(tokens.input, pricing?.inputCenticentsPerMillionTokens) +
    tokenCost(tokens.output, pricing?.outputCenticentsPerMillionTokens) +
    tokenCost(tokens.cacheRead, pricing?.cacheReadCenticentsPerMillionTokens) +
    tokenCost(tokens.cacheWrite, pricing?.cacheWriteCenticentsPerMillionTokens)
  );
}

function calculateToolCostCenticents(
  _toolType: string,
  _callCount: number,
  _durationSeconds?: number,
): number {
  return 0;
}

function calculateToolUsageCostCenticents(tools: readonly ToolUsage[]): number {
  return tools.reduce(
    (sum, tool) =>
      sum +
      calculateToolCostCenticents(tool.type, tool.count, tool.durationSeconds),
    0,
  );
}

export const PricingFromModelInfo = Layer.effect(
  Pricing,
  Effect.gen(function* () {
    const modelInfo = yield* ModelInfo;

    const service: PricingService = {
      llmCost: (tokens, tools, modelId) => {
        const info = modelInfo.get(modelId);
        return (
          calculateTokenCostCenticents(tokens, info.pricing) +
          calculateToolUsageCostCenticents(tools)
        );
      },
      toolCost: calculateToolCostCenticents,
    };

    return service;
  }),
);
