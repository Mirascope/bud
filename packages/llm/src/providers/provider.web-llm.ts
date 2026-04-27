import type { StreamResponseChunk } from "../responses/chunks.ts";
import {
  buildOpenAIChatCompletionsRequestBody,
  decodeOpenAIChatCompletionsResponse,
  decodeOpenAIChatCompletionsStream,
  type OpenAIChatResponse,
  type OpenAIChatStreamEvent,
} from "./provider.openai.completions.ts";
import {
  Provider,
  ProviderError,
  stripProviderPrefix,
  type ProviderCallArgs,
  type ProviderService,
} from "./provider.schemas.ts";
import { functionCallingModelIds, prebuiltAppConfig } from "@mlc-ai/web-llm";
import type {
  AppConfig,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequestBase,
  ChatOptions,
  MLCEngineConfig,
  ModelRecord,
} from "@mlc-ai/web-llm";
import { Effect, Layer, Stream } from "effect";

export const WEB_LLM_PROVIDER_ID = "web-llm";
export const WEB_LLM_HERMES_3_MODEL_ID = "Hermes-3-Llama-3.1-8B-q4f16_1-MLC";
export const WEB_LLM_GEMMA_4_MODEL_ID = "gemma-4-E2B-it-q4f16_1-MLC";
export const WEB_LLM_DEFAULT_MODEL_ID = WEB_LLM_HERMES_3_MODEL_ID;
export const WEB_LLM_FUNCTION_CALLING_MODEL_IDS = [
  ...functionCallingModelIds.filter((modelId) =>
    modelId.startsWith("Hermes-3-"),
  ),
] as readonly string[];

const GEMMA_4_REPO =
  "https://huggingface.co/welcoma/gemma-4-E2B-it-q4f16_1-MLC";

export const WEB_LLM_GEMMA_4_MODEL_RECORD: ModelRecord = {
  model: GEMMA_4_REPO,
  model_id: WEB_LLM_GEMMA_4_MODEL_ID,
  model_lib: `${GEMMA_4_REPO}/resolve/main/libs/gemma-4-E2B-it-q4f16_1-MLC-webgpu.wasm`,
  overrides: {
    sliding_window_size: -1,
  },
  required_features: ["shader-f16"],
};

export const WebLLMDefaultAppConfig: AppConfig = {
  ...prebuiltAppConfig,
  useIndexedDBCache: true,
};

export interface WebLLMEngine {
  readonly chat: {
    readonly completions: {
      readonly create: (
        request: ChatCompletionRequestBase,
      ) => Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
    };
  };
  readonly unload?: () => Promise<void>;
}

export interface WebLLMProviderOptions {
  readonly modelId?: string;
  readonly appConfig?: AppConfig;
  readonly engineConfig?: Omit<MLCEngineConfig, "appConfig">;
  readonly chatOptions?: ChatOptions;
  readonly engine?: WebLLMEngine;
  readonly createEngine?: (
    modelId: string,
    engineConfig: MLCEngineConfig,
    chatOptions?: ChatOptions,
  ) => Promise<WebLLMEngine>;
}

export interface WebLLMProviderService extends ProviderService {
  readonly preload: (
    modelId?: string,
  ) => Effect.Effect<WebLLMEngine, ProviderError>;
  readonly hasCachedModel: (
    modelId?: string,
  ) => Effect.Effect<boolean, ProviderError>;
  readonly deleteCachedModel: (
    modelId?: string,
  ) => Effect.Effect<void, ProviderError>;
}

function resolveWebLLMModelId(
  requestedModelId: string,
  defaultModelId: string,
): string {
  const stripped = stripProviderPrefix(requestedModelId);
  if (
    stripped === WEB_LLM_PROVIDER_ID ||
    stripped === "local" ||
    stripped === "hermes-3"
  ) {
    return defaultModelId;
  }
  return stripped;
}

function webLLMProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError({
    message,
    providerId: WEB_LLM_PROVIDER_ID,
    kind: "unknown",
    cause: error,
  });
}

function buildWebLLMRequest(
  args: ProviderCallArgs,
  modelId: string,
  stream: boolean,
  includeTools = true,
): ChatCompletionRequestBase {
  if (
    includeTools &&
    args.tools &&
    args.tools.length > 0 &&
    !functionCallingModelIds.includes(modelId)
  ) {
    throw new ProviderError({
      message: `${modelId} does not support tool use in WebLLM.`,
      providerId: WEB_LLM_PROVIDER_ID,
      kind: "invalid_request",
    });
  }
  const providerArgs = {
    ...args,
    modelId: `${WEB_LLM_PROVIDER_ID}/${modelId}`,
    ...(includeTools ? {} : { tools: [] }),
  };
  return {
    ...(buildOpenAIChatCompletionsRequestBody(providerArgs) as Record<
      string,
      unknown
    >),
    model: modelId,
    ...(stream
      ? { stream: true, stream_options: { include_usage: true } }
      : { stream: false }),
  } as ChatCompletionRequestBase;
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value != null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

async function createWebLLMCompletion(
  engine: WebLLMEngine,
  args: ProviderCallArgs,
  modelId: string,
  stream: false,
): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
async function createWebLLMCompletion(
  engine: WebLLMEngine,
  args: ProviderCallArgs,
  modelId: string,
  stream: true,
): Promise<AsyncIterable<ChatCompletionChunk>>;
async function createWebLLMCompletion(
  engine: WebLLMEngine,
  args: ProviderCallArgs,
  modelId: string,
  stream: boolean,
): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
  try {
    return await engine.chat.completions.create(
      buildWebLLMRequest(args, modelId, stream),
    );
  } catch (error) {
    if (!args.tools?.length || !isWebLLMToolParseError(error)) {
      throw error;
    }
    return engine.chat.completions.create(
      buildWebLLMRequest(args, modelId, stream, false),
    );
  }
}

async function* createWebLLMDecodedStream(
  engine: WebLLMEngine,
  args: ProviderCallArgs,
  modelId: string,
): AsyncGenerator<StreamResponseChunk> {
  try {
    const response = await createWebLLMCompletion(engine, args, modelId, true);
    if (!isAsyncIterable<ChatCompletionChunk>(response)) {
      throw new ProviderError({
        message: "WebLLM returned a response for a streaming call",
        providerId: WEB_LLM_PROVIDER_ID,
        kind: "unknown",
      });
    }
    yield* decodeOpenAIChatCompletionsStream(
      response as AsyncIterable<OpenAIChatStreamEvent>,
      { closeOnFinishReason: true },
    );
  } catch (error) {
    if (!args.tools?.length || !isWebLLMToolParseError(error)) {
      throw error;
    }
    const response = await engine.chat.completions.create(
      buildWebLLMRequest(args, modelId, true, false),
    );
    if (!isAsyncIterable<ChatCompletionChunk>(response)) {
      throw new ProviderError({
        message: "WebLLM returned a response for a streaming call",
        providerId: WEB_LLM_PROVIDER_ID,
        kind: "unknown",
      });
    }
    yield* decodeOpenAIChatCompletionsStream(
      response as AsyncIterable<OpenAIChatStreamEvent>,
      { closeOnFinishReason: true },
    );
  }
}

function isWebLLMToolParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("ToolCallOutputParseError") ||
    (message.includes("function calling") &&
      message.includes("is not valid JSON"))
  );
}

async function createDefaultWebLLMEngine(
  modelId: string,
  engineConfig: MLCEngineConfig,
  chatOptions?: ChatOptions,
): Promise<WebLLMEngine> {
  if (typeof Worker === "undefined") {
    throw new ProviderError({
      message: "WebLLM requires a browser Worker runtime",
      providerId: WEB_LLM_PROVIDER_ID,
      kind: "invalid_request",
    });
  }

  const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
  const worker = new Worker(new URL("./web-llm.worker.ts", import.meta.url), {
    type: "module",
  });
  return CreateWebWorkerMLCEngine(worker, modelId, engineConfig, chatOptions);
}

export function makeWebLLMProvider(
  options: WebLLMProviderOptions = {},
): WebLLMProviderService {
  const defaultModelId = options.modelId ?? WEB_LLM_DEFAULT_MODEL_ID;
  const createEngine = options.createEngine ?? createDefaultWebLLMEngine;
  const appConfig = options.appConfig ?? WebLLMDefaultAppConfig;
  const engineCache = new Map<string, Promise<WebLLMEngine>>();

  const getEngine = (modelId: string): Promise<WebLLMEngine> => {
    if (options.engine) return Promise.resolve(options.engine);
    const cached = engineCache.get(modelId);
    if (cached) return cached;

    const engine = createEngine(
      modelId,
      {
        ...options.engineConfig,
        appConfig,
      },
      options.chatOptions,
    );
    engineCache.set(modelId, engine);
    return engine;
  };

  return {
    id: WEB_LLM_PROVIDER_ID,
    preload: (modelId = `${WEB_LLM_PROVIDER_ID}/${defaultModelId}`) =>
      Effect.tryPromise({
        try: () => getEngine(resolveWebLLMModelId(modelId, defaultModelId)),
        catch: webLLMProviderError,
      }),
    hasCachedModel: (modelId = `${WEB_LLM_PROVIDER_ID}/${defaultModelId}`) =>
      Effect.tryPromise({
        try: async () => {
          const { hasModelInCache } = await import("@mlc-ai/web-llm");
          return hasModelInCache(
            resolveWebLLMModelId(modelId, defaultModelId),
            appConfig,
          );
        },
        catch: webLLMProviderError,
      }),
    deleteCachedModel: (modelId = `${WEB_LLM_PROVIDER_ID}/${defaultModelId}`) =>
      Effect.tryPromise({
        try: async () => {
          const resolvedModelId = resolveWebLLMModelId(modelId, defaultModelId);
          const engine = await engineCache
            .get(resolvedModelId)
            ?.catch(() => null);
          await engine?.unload?.();
          engineCache.delete(resolvedModelId);

          const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
          await deleteModelAllInfoInCache(resolvedModelId, appConfig);
        },
        catch: webLLMProviderError,
      }),
    call: (args) =>
      Effect.tryPromise({
        try: async () => {
          const modelId = resolveWebLLMModelId(args.modelId, defaultModelId);
          const engine = await getEngine(modelId);
          const response = await createWebLLMCompletion(
            engine,
            args,
            modelId,
            false,
          );
          if (isAsyncIterable<ChatCompletionChunk>(response)) {
            throw new ProviderError({
              message: "WebLLM returned a stream for a non-streaming call",
              providerId: WEB_LLM_PROVIDER_ID,
              kind: "unknown",
            });
          }
          return decodeOpenAIChatCompletionsResponse(
            response as OpenAIChatResponse,
            args,
            WEB_LLM_PROVIDER_ID,
          );
        },
        catch: webLLMProviderError,
      }),
    stream: (args) =>
      Stream.unwrap(
        Effect.tryPromise({
          try: async () => {
            const modelId = resolveWebLLMModelId(args.modelId, defaultModelId);
            const engine = await getEngine(modelId);
            return Stream.fromAsyncIterable(
              createWebLLMDecodedStream(engine, args, modelId),
              webLLMProviderError,
            );
          },
          catch: webLLMProviderError,
        }),
      ),
  };
}

export function WebLLMProvider(
  options: WebLLMProviderOptions = {},
): Layer.Layer<Provider> {
  return Layer.succeed(Provider, makeWebLLMProvider(options));
}
