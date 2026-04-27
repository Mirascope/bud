import type { StreamResponseChunk } from "../responses/chunks.ts";
import type { Response } from "../responses/response.ts";
import { makeOpenAIChatCompletionsProvider } from "./provider.openai.completions.ts";
import { makeOpenAIResponsesProvider } from "./provider.openai.responses.ts";
import {
  Provider,
  type ProviderCallArgs,
  type ProviderError,
  type ProviderService,
} from "./provider.schemas.ts";
import { Effect, Layer, Stream } from "effect";

export type OpenAIProviderMode =
  | "responses"
  | "completions"
  | "chat-completions";

export interface OpenAIProviderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly mode?: OpenAIProviderMode;
  readonly fetch?: typeof globalThis.fetch;
}

function normalizeMode(mode: OpenAIProviderMode): "responses" | "completions" {
  return mode === "chat-completions" ? "completions" : mode;
}

function chooseMode(
  options: OpenAIProviderOptions,
  args: ProviderCallArgs,
): "responses" | "completions" {
  if (options.mode) return normalizeMode(options.mode);
  if (args.modelId.endsWith(":responses")) return "responses";
  if (
    args.modelId.endsWith(":completions") ||
    args.modelId.endsWith(":chat-completions")
  ) {
    return "completions";
  }
  return args.modelId.startsWith("openai/") ? "responses" : "completions";
}

function stripModeSuffix(modelId: string): string {
  return modelId.replace(/:(?:responses|completions|chat-completions)$/, "");
}

export function makeOpenAIProvider(
  options: OpenAIProviderOptions = {},
): ProviderService {
  const endpointOptions = {
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: options.fetch,
  };
  const responses = makeOpenAIResponsesProvider(endpointOptions);
  const completions = makeOpenAIChatCompletionsProvider(endpointOptions);

  const route = (
    args: ProviderCallArgs,
  ): { provider: ProviderService; args: ProviderCallArgs } => {
    const mode = chooseMode(options, args);
    return {
      provider: mode === "responses" ? responses : completions,
      args: { ...args, modelId: stripModeSuffix(args.modelId) },
    };
  };

  return {
    id: "openai",
    call: (args): Effect.Effect<Response, ProviderError> => {
      const routed = route(args);
      return routed.provider.call(routed.args);
    },
    stream: (args): Stream.Stream<StreamResponseChunk, ProviderError> => {
      const routed = route(args);
      return routed.provider.stream(routed.args);
    },
  };
}

export function OpenAIProvider(
  options: OpenAIProviderOptions = {},
): Layer.Layer<Provider> {
  return Layer.succeed(Provider, makeOpenAIProvider(options));
}
