import { Context } from "effect";

export interface ModelPricing {
  readonly inputCenticentsPerMillionTokens?: number;
  readonly outputCenticentsPerMillionTokens?: number;
  readonly cacheReadCenticentsPerMillionTokens?: number;
  readonly cacheWriteCenticentsPerMillionTokens?: number;
}

export interface ModelCapabilities {
  readonly tools?: boolean;
  readonly vision?: boolean;
  readonly audio?: boolean;
  readonly documents?: boolean;
  readonly imageGeneration?: boolean;
  readonly thinking?: boolean;
}

export interface ModelInfoData {
  readonly id: string;
  readonly providerId?: string;
  readonly providerModelName?: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly pricing?: ModelPricing;
  readonly supports?: ModelCapabilities;
}

export interface ModelInfoService {
  readonly get: (modelId: string) => ModelInfoData;
}

export class ModelInfo extends Context.Tag("@bud/llm/ModelInfo")<
  ModelInfo,
  ModelInfoService
>() {}

export function providerIdFromModelId(modelId: string): string | undefined {
  const slashIndex = modelId.indexOf("/");
  return slashIndex > 0 ? modelId.slice(0, slashIndex) : undefined;
}
