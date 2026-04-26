import {
  ModelInfo,
  providerIdFromModelId,
  type ModelInfoData,
  type ModelInfoService,
} from "./model-info.ts";
import { Layer } from "effect";

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

export const DEFAULT_MODEL_INFO: Omit<
  ModelInfoData,
  "id" | "providerId" | "providerModelName"
> = {
  contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  pricing: {
    inputCenticentsPerMillionTokens: 0,
    outputCenticentsPerMillionTokens: 0,
    cacheReadCenticentsPerMillionTokens: 0,
    cacheWriteCenticentsPerMillionTokens: 0,
  },
};

export function defaultModelInfo(modelId: string): ModelInfoData {
  const providerId = providerIdFromModelId(modelId);
  return {
    ...DEFAULT_MODEL_INFO,
    id: modelId,
    ...(providerId ? { providerId } : {}),
    providerModelName: providerId
      ? modelId.slice(providerId.length + 1)
      : modelId,
  };
}

export const defaultModelInfoService: ModelInfoService = {
  get: defaultModelInfo,
};

export const ModelInfoDefault = Layer.succeed(
  ModelInfo,
  defaultModelInfoService,
);
