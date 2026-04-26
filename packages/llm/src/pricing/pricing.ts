import type { TokenUsage, ToolUsage } from "../responses/usage.ts";
import { Context } from "effect";

export interface PricingService {
  readonly llmCost: (
    tokens: TokenUsage,
    tools: readonly ToolUsage[],
    modelId: string,
  ) => number;

  readonly toolCost: (
    toolType: string,
    callCount: number,
    durationSeconds?: number,
  ) => number;
}

export class Pricing extends Context.Tag("@bud/llm/Pricing")<
  Pricing,
  PricingService
>() {}
