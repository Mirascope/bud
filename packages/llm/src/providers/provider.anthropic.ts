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

const PROVIDER_ID = "anthropic";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicProviderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly version?: string;
  readonly fetch?: typeof globalThis.fetch;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | Record<string, unknown>;

interface AnthropicMessageResponse {
  readonly role: "assistant";
  readonly content: AnthropicContentBlock[];
  readonly model: string;
  readonly stop_reason: string | null;
  readonly usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
}

type AnthropicRequestContentBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | {
      type: "image";
      source:
        | { type: "base64"; media_type: string; data: string }
        | { type: "url"; url: string };
      cache_control?: { type: "ephemeral" };
    }
  | {
      type: "document";
      source:
        | { type: "base64"; media_type: "application/pdf"; data: string }
        | { type: "text"; media_type: "text/plain"; data: string }
        | { type: "url"; url: string };
      cache_control?: { type: "ephemeral" };
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
      cache_control?: { type: "ephemeral" };
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error: boolean;
      cache_control?: { type: "ephemeral" };
    };

interface AnthropicRequestMessage {
  readonly role: "user" | "assistant";
  readonly content: string | AnthropicRequestContentBlock[];
}

interface AnthropicStreamEvent {
  readonly type: string;
  readonly message?: AnthropicMessageResponse;
  readonly content_block?: AnthropicContentBlock;
  readonly delta?: Record<string, unknown>;
  readonly usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function getDefaultApiKey(): string | undefined {
  return typeof Bun !== "undefined" ? Bun.env.ANTHROPIC_API_KEY : undefined;
}

function normalizeBaseUrl(baseURL: string): string {
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

function buildHeaders(
  apiKey: string,
  version: string,
  stream: boolean,
): HeadersInit {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": version,
    ...(stream ? { accept: "text/event-stream" } : {}),
  };
}

function toAnthropicImageMimeType(mimeType: string): string {
  if (
    mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/gif" ||
    mimeType === "image/webp"
  ) {
    return mimeType;
  }
  throw new Error(`Anthropic does not support image format: ${mimeType}`);
}

function encodeImage(image: Image): AnthropicRequestContentBlock {
  if (image.source.type === "base64_image_source") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: toAnthropicImageMimeType(image.source.mimeType),
        data: image.source.data,
      },
    };
  }
  return {
    type: "image",
    source: { type: "url", url: image.source.url },
  };
}

function encodeDocument(document: Document): AnthropicRequestContentBlock {
  switch (document.source.type) {
    case "base64_document_source":
      return {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: document.source.data,
        },
      };
    case "text_document_source":
      return {
        type: "document",
        source: {
          type: "text",
          media_type: "text/plain",
          data: document.source.data,
        },
      };
    case "url_document_source":
      return {
        type: "document",
        source: { type: "url", url: document.source.url },
      };
  }
}

function encodeContentParts(
  content: readonly (UserContentPart | AssistantContentPart)[],
): AnthropicRequestContentBlock[] {
  const blocks: AnthropicRequestContentBlock[] = [];

  for (const part of content) {
    switch (part.type) {
      case "text":
        blocks.push({ type: "text", text: part.text });
        break;
      case "image":
        blocks.push(encodeImage(part));
        break;
      case "audio":
        throw new Error("Anthropic does not support audio inputs");
      case "document":
        blocks.push(encodeDocument(part));
        break;
      case "tool_call":
        blocks.push({
          type: "tool_use",
          id: part.id,
          name: part.name,
          input: JSON.parse(part.args) as unknown,
        });
        break;
      case "tool_output":
        blocks.push({
          type: "tool_result",
          tool_use_id: part.id,
          content: part.result,
          is_error: part.isError,
        });
        break;
      case "thought":
        break;
    }
  }

  return blocks;
}

function simplifyContent(
  blocks: AnthropicRequestContentBlock[],
): string | AnthropicRequestContentBlock[] {
  return blocks.length === 1 && blocks[0]?.type === "text"
    ? blocks[0].text
    : blocks;
}

function encodeMessages(messages: readonly Message[]): {
  system?: string;
  messages: AnthropicRequestMessage[];
} {
  let system: string | undefined;
  const encoded: AnthropicRequestMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      system = message.content.text;
      continue;
    }

    const blocks = encodeContentParts(message.content);
    encoded.push({
      role: message.role,
      content: simplifyContent(blocks),
    });
  }

  return { ...(system ? { system } : {}), messages: encoded };
}

function encodeTool(tool: ToolSchema): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  };
}

function computeThinkingBudget(level: string, maxTokens: number): number {
  const multiplier =
    level === "minimal"
      ? 0
      : level === "low"
        ? 0.2
        : level === "medium"
          ? 0.4
          : level === "high"
            ? 0.6
            : level === "extra-high"
              ? 0.85
              : -1;
  if (multiplier < 0) return -1;
  if (multiplier === 0) return 0;
  return Math.max(1024, Math.floor(maxTokens * multiplier));
}

export function buildAnthropicRequestBody(args: ProviderCallArgs): unknown {
  const model = stripProviderPrefix(args.modelId);
  const params: Params | undefined = args.params;
  const maxTokens = params?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const encoded = encodeMessages(args.messages);

  const body: Record<string, unknown> = {
    model,
    messages: encoded.messages,
    max_tokens: maxTokens,
  };

  if (encoded.system) {
    body.system = encoded.system;
  }
  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools.map(encodeTool);
  }
  if (params?.temperature !== undefined) body.temperature = params.temperature;
  if (params?.topP !== undefined) body.top_p = params.topP;
  if (params?.topK !== undefined) body.top_k = params.topK;
  if (params?.stopSequences !== undefined) {
    body.stop_sequences = [...params.stopSequences];
  }
  if (params?.thinking?.level) {
    const budget =
      params.thinking.budgetTokens ??
      computeThinkingBudget(params.thinking.level, maxTokens);
    if (budget === 0) {
      body.thinking = { type: "disabled" };
    } else if (budget > 0) {
      body.thinking = { type: "enabled", budget_tokens: budget };
    }
  }

  return body;
}

function decodeContent(
  content: readonly AnthropicContentBlock[],
): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];

  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push({ type: "text", text: block.text });
    } else if (
      block.type === "thinking" &&
      typeof block.thinking === "string"
    ) {
      parts.push({ type: "thought", thought: block.thinking });
    } else if (block.type === "tool_use") {
      parts.push({
        type: "tool_call",
        id: String(block.id),
        name: String(block.name),
        args: JSON.stringify(block.input ?? {}),
      });
    }
  }

  return parts;
}

function decodeFinishReason(stopReason: string | null): FinishReason {
  switch (stopReason) {
    case "max_tokens":
      return "max_tokens";
    case "tool_use":
      return "tool_use";
    default:
      return "stop";
  }
}

function decodeUsage(response: AnthropicMessageResponse): Usage {
  const usage = response.usage;
  return createUsage({
    tokens: {
      input: usage?.input_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      cacheRead: usage?.cache_read_input_tokens ?? 0,
      cacheWrite: usage?.cache_creation_input_tokens ?? 0,
    },
    tools: usage?.server_tool_use?.web_search_requests
      ? [
          {
            type: "anthropic_web_search",
            count: usage.server_tool_use.web_search_requests,
          },
        ]
      : [],
  });
}

function decodeResponse(
  response: AnthropicMessageResponse,
  args: ProviderCallArgs,
): LlmResponse {
  const model = stripProviderPrefix(args.modelId);
  return new LlmResponse({
    content: decodeContent(response.content),
    usage: decodeUsage(response),
    finishReason: decodeFinishReason(response.stop_reason),
    rawMessage: { role: response.role, content: response.content },
    providerId: PROVIDER_ID,
    modelId: args.modelId,
    providerModelName: response.model ?? model,
    inputMessages: [...args.messages],
    tools: [],
    toolSchemas: args.tools ? [...args.tools] : [],
  });
}

function providerErrorKind(status: number): ProviderError["kind"] {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 400) return "invalid_request";
  if (status === 500 || status === 502 || status === 503) {
    return "server_error";
  }
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

async function fetchAnthropic(
  fetchImpl: typeof globalThis.fetch,
  apiKey: string,
  baseURL: string,
  version: string,
  args: ProviderCallArgs,
  stream: boolean,
): Promise<globalThis.Response> {
  const response = await fetchImpl(`${normalizeBaseUrl(baseURL)}/v1/messages`, {
    method: "POST",
    headers: buildHeaders(apiKey, version, stream),
    body: JSON.stringify({
      ...(buildAnthropicRequestBody(args) as Record<string, unknown>),
      ...(stream ? { stream: true } : {}),
    }),
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
    message: "Missing Anthropic API key",
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

function decodeStopReason(stopReason: unknown): FinishReason | null {
  return typeof stopReason === "string" ? decodeFinishReason(stopReason) : null;
}

async function* parseSseEvents(
  response: globalThis.Response,
): AsyncGenerator<AnthropicStreamEvent> {
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

      const dataLines = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      const data = dataLines.join("\n");
      if (data && data !== "[DONE]") {
        yield JSON.parse(data) as AnthropicStreamEvent;
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

async function* decodeStream(
  events: AsyncIterable<AnthropicStreamEvent>,
): AsyncGenerator<StreamResponseChunk> {
  let current:
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "tool_use"; id: string; name: string; inputJson: string }
    | null = null;
  const rawBlocks: AnthropicContentBlock[] = [];

  for await (const event of events) {
    yield rawStreamEventChunk(event);

    switch (event.type) {
      case "message_start":
        if (event.message?.usage) {
          yield usageDeltaChunk({
            inputTokens: event.message.usage.input_tokens ?? 0,
            outputTokens: event.message.usage.output_tokens ?? 0,
          });
        }
        break;

      case "content_block_start":
        if (event.content_block?.type === "text") {
          current = { type: "text", text: "" };
          yield textStart();
          if (typeof event.content_block.text === "string") {
            current.text += event.content_block.text;
            yield textChunk(event.content_block.text);
          }
        } else if (event.content_block?.type === "thinking") {
          current = { type: "thinking", thinking: "" };
          yield thoughtStart();
        } else if (event.content_block?.type === "tool_use") {
          current = {
            type: "tool_use",
            id: String(event.content_block.id),
            name: String(event.content_block.name),
            inputJson: "",
          };
          yield toolCallStart(current.id, current.name);
        }
        break;

      case "content_block_delta": {
        const deltaType = event.delta?.type;
        if (current?.type === "text" && deltaType === "text_delta") {
          const text = String(event.delta?.text ?? "");
          current.text += text;
          yield textChunk(text);
        } else if (
          current?.type === "thinking" &&
          deltaType === "thinking_delta"
        ) {
          const thinking = String(event.delta?.thinking ?? "");
          current.thinking += thinking;
          yield thoughtChunk(thinking);
        } else if (
          current?.type === "tool_use" &&
          deltaType === "input_json_delta"
        ) {
          const partialJson = String(event.delta?.partial_json ?? "");
          current.inputJson += partialJson;
          yield toolCallChunk(current.id, partialJson);
        }
        break;
      }

      case "content_block_stop":
        if (current?.type === "text") {
          rawBlocks.push({ type: "text", text: current.text });
          yield textEnd();
        } else if (current?.type === "thinking") {
          rawBlocks.push({ type: "thinking", thinking: current.thinking });
          yield thoughtEnd();
        } else if (current?.type === "tool_use") {
          let input: unknown = {};
          try {
            input = current.inputJson ? JSON.parse(current.inputJson) : {};
          } catch {
            input = {};
          }
          rawBlocks.push({
            type: "tool_use",
            id: current.id,
            name: current.name,
            input,
          });
          yield toolCallEnd(current.id);
        }
        current = null;
        break;

      case "message_delta": {
        const reason = decodeStopReason(event.delta?.stop_reason);
        if (reason) yield finishReasonChunk(reason);
        if (event.usage) {
          yield usageDeltaChunk({
            outputTokens: event.usage.output_tokens ?? 0,
          });
        }
        break;
      }
    }
  }

  yield rawMessageChunk({ role: "assistant", content: rawBlocks });
}

export function makeAnthropicProvider(
  options: AnthropicProviderOptions = {},
): ProviderService {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseURL = options.baseURL ?? DEFAULT_BASE_URL;
  const version = options.version ?? DEFAULT_VERSION;

  return {
    id: PROVIDER_ID,
    call: (args) =>
      Effect.tryPromise({
        try: async () => {
          const apiKey = requireApiKey(options.apiKey ?? getDefaultApiKey());
          const response = await fetchAnthropic(
            fetchImpl,
            apiKey,
            baseURL,
            version,
            args,
            false,
          );
          return decodeResponse(
            (await response.json()) as AnthropicMessageResponse,
            args,
          );
        },
        catch: wrapUnknownError,
      }),
    stream: (args) =>
      Stream.unwrap(
        Effect.tryPromise({
          try: async () => {
            const apiKey = requireApiKey(options.apiKey ?? getDefaultApiKey());
            const response = await fetchAnthropic(
              fetchImpl,
              apiKey,
              baseURL,
              version,
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

export function AnthropicProvider(
  options: AnthropicProviderOptions = {},
): Layer.Layer<Provider> {
  return Layer.succeed(Provider, makeAnthropicProvider(options));
}
