import type { Audio } from "../content/audio.ts";
import type { Document } from "../content/document.ts";
import type { Image } from "../content/image.ts";
import type {
  AssistantContentPart,
  UserContentPart,
} from "../content/index.ts";
import {
  textChunk,
  textEnd,
  textStart,
  thoughtChunk,
  thoughtEnd,
  thoughtStart,
  toolCallChunk,
  toolCallEnd,
  toolCallStart,
} from "../content/index.ts";
import type { Message } from "../messages/message.ts";
import {
  finishReasonChunk,
  rawMessageChunk,
  rawStreamEventChunk,
  usageDeltaChunk,
  type StreamResponseChunk,
} from "../responses/chunks.ts";
import type { FinishReason } from "../responses/finish-reason.ts";
import type { Params } from "../responses/params.ts";
import { Response as LlmResponse } from "../responses/response.ts";
import { createUsage, type Usage } from "../responses/usage.ts";
import type { ToolSchema } from "../tools/tool-schema.ts";
import {
  Provider,
  ProviderError,
  stripProviderPrefix,
  type ProviderCallArgs,
  type ProviderService,
} from "./provider.schemas.ts";
import { Effect, Layer, Stream } from "effect";

const PROVIDER_ID = "google";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MAX_TOKENS = 8192;
const UNKNOWN_TOOL_ID = "google_unknown_tool_id";

export interface GoogleProviderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
}

interface GoogleBlob {
  readonly data: string;
  readonly mimeType: string;
}

type GooglePart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: GoogleBlob }
  | {
      functionCall: {
        id?: string;
        name: string;
        args: Record<string, unknown>;
      };
      thoughtSignature?: string;
    }
  | {
      functionResponse: {
        id?: string;
        name: string;
        response: { output: string };
      };
    };

interface GoogleContent {
  readonly role?: "user" | "model";
  readonly parts: GooglePart[];
}

interface GoogleRequestBody {
  readonly contents: GoogleContent[];
  readonly systemInstruction?: {
    readonly parts: readonly [{ readonly text: string }];
  };
  readonly tools?: readonly unknown[];
  readonly generationConfig?: Record<string, unknown>;
}

interface GoogleResponse {
  readonly candidates?: GoogleCandidate[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly thoughtsTokenCount?: number;
  };
  readonly modelVersion?: string;
  readonly responseId?: string;
}

interface GoogleCandidate {
  readonly content?: GoogleContent;
  readonly finishReason?: string;
  readonly groundingMetadata?: {
    readonly webSearchQueries?: string[];
    readonly groundingSupports?: unknown[];
  };
}

function getDefaultApiKey(): string | undefined {
  return typeof Bun !== "undefined" ? Bun.env.GOOGLE_API_KEY : undefined;
}

function normalizeBaseUrl(baseURL: string): string {
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

function modelName(modelId: string): string {
  const stripped = stripProviderPrefix(modelId);
  return stripped.startsWith("models/")
    ? stripped.slice("models/".length)
    : stripped;
}

function endpoint(baseURL: string, modelId: string, stream: boolean): string {
  const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  return `${normalizeBaseUrl(baseURL)}/models/${modelName(modelId)}:${action}`;
}

function buildHeaders(apiKey: string, stream: boolean): HeadersInit {
  return {
    "content-type": "application/json",
    "x-goog-api-key": apiKey,
    ...(stream ? { accept: "text/event-stream" } : {}),
  };
}

function encodeImage(image: Image): GooglePart {
  if (image.source.type === "url_image_source") {
    throw new Error("Google does not support URL-referenced images");
  }
  if (image.source.type === "object_storage_image_source") {
    throw new Error("Object storage image sources must be resolved first");
  }
  return {
    inlineData: {
      data: image.source.data,
      mimeType: image.source.mimeType,
    },
  };
}

function encodeAudio(audio: Audio): GooglePart {
  if (audio.source.type === "object_storage_audio_source") {
    throw new Error("Object storage audio sources must be resolved first");
  }
  return {
    inlineData: {
      data: audio.source.data,
      mimeType: audio.source.mimeType,
    },
  };
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeDocument(document: Document): GooglePart {
  switch (document.source.type) {
    case "base64_document_source":
      return {
        inlineData: {
          data: document.source.data,
          mimeType: document.source.mediaType,
        },
      };
    case "text_document_source":
      return {
        inlineData: {
          data: textToBase64(document.source.data),
          mimeType: document.source.mediaType,
        },
      };
    case "url_document_source":
      throw new Error("Google does not support URL-referenced documents");
    case "object_storage_document_source":
      throw new Error("Object storage document sources must be resolved first");
  }
}

function encodeContentParts(
  content: readonly (UserContentPart | AssistantContentPart)[],
): GooglePart[] {
  const parts: GooglePart[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push({ text: part.text });
        break;
      case "image":
        parts.push(encodeImage(part));
        break;
      case "audio":
        parts.push(encodeAudio(part));
        break;
      case "document":
        parts.push(encodeDocument(part));
        break;
      case "tool_call": {
        const toolPart: GooglePart = {
          functionCall: {
            ...(part.id !== UNKNOWN_TOOL_ID ? { id: part.id } : {}),
            name: part.name,
            args: JSON.parse(part.args) as Record<string, unknown>,
          },
          ...(part.thoughtSignature
            ? { thoughtSignature: part.thoughtSignature }
            : {}),
        };
        parts.push(toolPart);
        break;
      }
      case "tool_output":
        parts.push({
          functionResponse: {
            ...(part.id !== UNKNOWN_TOOL_ID ? { id: part.id } : {}),
            name: part.name,
            response: { output: part.result },
          },
        });
        break;
      case "thought":
        break;
    }
  }
  return parts;
}

function encodeMessages(
  messages: readonly Message[],
  modelId: string,
): {
  systemInstruction?: { parts: [{ text: string }] };
  contents: GoogleContent[];
} {
  let systemInstruction: { parts: [{ text: string }] } | undefined;
  const contents: GoogleContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemInstruction = { parts: [{ text: message.content.text }] };
    } else if (message.role === "user") {
      contents.push({
        role: "user",
        parts: encodeContentParts(message.content),
      });
    } else if (
      message.providerId === PROVIDER_ID &&
      message.modelId === modelId &&
      message.rawMessage
    ) {
      contents.push(message.rawMessage as GoogleContent);
    } else {
      contents.push({
        role: "model",
        parts: encodeContentParts(message.content),
      });
    }
  }

  return { ...(systemInstruction ? { systemInstruction } : {}), contents };
}

function encodeTools(
  tools: readonly ToolSchema[],
): readonly Record<string, unknown>[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: {
          type: "object",
          properties: tool.parameters.properties,
          required: [...tool.parameters.required],
        },
      })),
    },
  ];
}

export function buildGoogleRequestBody(
  args: ProviderCallArgs,
): GoogleRequestBody {
  const model = modelName(args.modelId);
  const params: Params | undefined = args.params;
  const encoded = encodeMessages(args.messages, model);
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: params?.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  if (params?.temperature !== undefined) {
    generationConfig.temperature = params.temperature;
  }
  if (params?.topP !== undefined) generationConfig.topP = params.topP;
  if (params?.topK !== undefined) generationConfig.topK = params.topK;
  if (params?.seed !== undefined) generationConfig.seed = params.seed;
  if (params?.stopSequences !== undefined) {
    generationConfig.stopSequences = [...params.stopSequences];
  }
  if (params?.thinking?.budgetTokens !== undefined) {
    generationConfig.thinkingConfig = {
      thinkingBudget: params.thinking.budgetTokens,
      includeThoughts: true,
    };
  }

  return {
    contents: encoded.contents,
    ...(encoded.systemInstruction
      ? { systemInstruction: encoded.systemInstruction }
      : {}),
    ...(args.tools && args.tools.length > 0
      ? { tools: encodeTools(args.tools) }
      : {}),
    generationConfig,
  };
}

function decodeFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "IMAGE_SAFETY":
    case "IMAGE_PROHIBITED_CONTENT":
      return "refusal";
    default:
      return "stop";
  }
}

function decodeParts(
  parts: readonly GooglePart[] | undefined,
  includeThoughts: boolean,
): AssistantContentPart[] {
  const result: AssistantContentPart[] = [];
  for (const part of parts ?? []) {
    if ("text" in part && part.text !== undefined) {
      if (part.thought === true) {
        if (includeThoughts)
          result.push({ type: "thought", thought: part.text });
      } else {
        result.push({ type: "text", text: part.text });
      }
    } else if ("functionCall" in part) {
      result.push({
        type: "tool_call",
        id: part.functionCall.id ?? UNKNOWN_TOOL_ID,
        name: part.functionCall.name ?? "unknown",
        args: JSON.stringify(part.functionCall.args ?? {}),
        ...(part.thoughtSignature
          ? { thoughtSignature: part.thoughtSignature }
          : {}),
      });
    }
  }
  return result;
}

function decodeUsage(response: GoogleResponse): Usage {
  const usage = response.usageMetadata;
  const grounding = response.candidates?.[0]?.groundingMetadata;
  const tools =
    grounding?.webSearchQueries &&
    grounding.webSearchQueries.length > 0 &&
    grounding.groundingSupports &&
    grounding.groundingSupports.length > 0
      ? [
          {
            type: "google_grounding_search",
            count: grounding.webSearchQueries.length,
          },
        ]
      : [];

  return createUsage({
    tokens: {
      input: usage?.promptTokenCount ?? 0,
      output: usage?.candidatesTokenCount ?? 0,
      reasoning: usage?.thoughtsTokenCount ?? 0,
    },
    tools,
  });
}

function decodeResponse(
  response: GoogleResponse,
  args: ProviderCallArgs,
  model: string,
): LlmResponse {
  const candidate = response.candidates?.[0];
  const content = decodeParts(candidate?.content?.parts, true);
  return new LlmResponse({
    content,
    usage: decodeUsage(response),
    finishReason: decodeFinishReason(candidate?.finishReason),
    rawMessage: candidate?.content ?? null,
    providerId: PROVIDER_ID,
    modelId: args.modelId,
    providerModelName: response.modelVersion ?? model,
    inputMessages: [...args.messages],
    tools: [],
    toolSchemas: args.tools ? [...args.tools] : [],
  });
}

function providerErrorKind(status: number): ProviderError["kind"] {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 400) return "invalid_request";
  if (status >= 500 && status <= 599) return "server_error";
  return "unknown";
}

async function parseErrorMessage(
  response: globalThis.Response,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return body.error?.message ?? body.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

async function fetchGoogle(
  fetchImpl: typeof globalThis.fetch,
  apiKey: string,
  baseURL: string,
  args: ProviderCallArgs,
  stream: boolean,
): Promise<globalThis.Response> {
  const response = await fetchImpl(endpoint(baseURL, args.modelId, stream), {
    method: "POST",
    headers: buildHeaders(apiKey, stream),
    body: JSON.stringify(buildGoogleRequestBody(args)),
  });

  if (!response.ok) {
    throw new ProviderError({
      message: await parseErrorMessage(response),
      providerId: PROVIDER_ID,
      kind: providerErrorKind(response.status),
      statusCode: response.status,
    });
  }

  return response;
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey) return apiKey;
  throw new ProviderError({
    message: "Missing Google API key",
    providerId: PROVIDER_ID,
    kind: "auth",
  });
}

function wrapUnknownError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError({
    message: error instanceof Error ? error.message : String(error),
    providerId: PROVIDER_ID,
    kind: "unknown",
    cause: error,
  });
}

async function* parseSseEvents(
  response: globalThis.Response,
): AsyncGenerator<GoogleResponse> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data) yield JSON.parse(data) as GoogleResponse;
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

async function* decodeStream(
  events: AsyncIterable<GoogleResponse>,
): AsyncGenerator<StreamResponseChunk> {
  let textStarted = false;
  let thoughtStarted = false;
  const accumulatedParts: GooglePart[] = [];

  for await (const event of events) {
    yield rawStreamEventChunk(event);
    const candidate = event.candidates?.[0];

    for (const part of candidate?.content?.parts ?? []) {
      accumulatedParts.push(part);
      if ("text" in part && part.text !== undefined) {
        if (part.thought === true) {
          if (!thoughtStarted) {
            thoughtStarted = true;
            yield thoughtStart();
          }
          yield thoughtChunk(part.text);
        } else {
          if (thoughtStarted) {
            thoughtStarted = false;
            yield thoughtEnd();
          }
          if (!textStarted) {
            textStarted = true;
            yield textStart();
          }
          yield textChunk(part.text);
        }
      } else if ("functionCall" in part) {
        if (textStarted) {
          textStarted = false;
          yield textEnd();
        }
        if (thoughtStarted) {
          thoughtStarted = false;
          yield thoughtEnd();
        }
        const id = part.functionCall.id ?? UNKNOWN_TOOL_ID;
        const name = part.functionCall.name ?? "unknown";
        const args = JSON.stringify(part.functionCall.args ?? {});
        yield toolCallStart(id, name, part.thoughtSignature);
        yield toolCallChunk(id, args);
        yield toolCallEnd(id);
      }
    }

    if (candidate?.finishReason) {
      if (textStarted) {
        textStarted = false;
        yield textEnd();
      }
      if (thoughtStarted) {
        thoughtStarted = false;
        yield thoughtEnd();
      }
      yield finishReasonChunk(decodeFinishReason(candidate.finishReason));
    }

    const usage = event.usageMetadata;
    if (usage) {
      yield usageDeltaChunk({
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        reasoningTokens: usage.thoughtsTokenCount ?? 0,
      });
    }
  }

  yield rawMessageChunk({ role: "model", parts: accumulatedParts });
}

export function makeGoogleProvider(
  options: GoogleProviderOptions = {},
): ProviderService {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseURL = options.baseURL ?? DEFAULT_BASE_URL;

  return {
    id: PROVIDER_ID,
    call: (args) =>
      Effect.tryPromise({
        try: async () => {
          const apiKey = requireApiKey(options.apiKey ?? getDefaultApiKey());
          const model = modelName(args.modelId);
          const response = await fetchGoogle(
            fetchImpl,
            apiKey,
            baseURL,
            args,
            false,
          );
          return decodeResponse(
            (await response.json()) as GoogleResponse,
            args,
            model,
          );
        },
        catch: wrapUnknownError,
      }),
    stream: (args) =>
      Stream.unwrap(
        Effect.tryPromise({
          try: async () => {
            const apiKey = requireApiKey(options.apiKey ?? getDefaultApiKey());
            const response = await fetchGoogle(
              fetchImpl,
              apiKey,
              baseURL,
              args,
              true,
            );
            return Stream.fromAsyncIterable(
              decodeStream(parseSseEvents(response)),
              wrapUnknownError,
            );
          },
          catch: wrapUnknownError,
        }),
      ),
  };
}

export function GoogleProvider(
  options: GoogleProviderOptions = {},
): Layer.Layer<Provider> {
  return Layer.succeed(Provider, makeGoogleProvider(options));
}
