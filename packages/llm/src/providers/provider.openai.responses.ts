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

const PROVIDER_ID = "openai";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 4096;

export type OpenAIProviderMode = "responses" | "chat-completions";

export interface OpenAIProviderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly mode?: OpenAIProviderMode;
  readonly fetch?: typeof globalThis.fetch;
}

type OpenAIRequestContentPart =
  | { type: "input_text"; text: string }
  | { type: "text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_file"; file_data?: string; filename?: string }
  | { type: "file"; file: { file_data?: string; filename?: string } };

type OpenAIResponsesInputItem =
  | {
      role: "system" | "user" | "assistant";
      content: string | OpenAIRequestContentPart[];
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

interface OpenAIUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
  };
  readonly completion_tokens_details?: {
    readonly reasoning_tokens?: number;
  };
}

interface OpenAIResponsesResponse {
  readonly id: string;
  readonly model: string;
  readonly output?: OpenAIResponsesOutputItem[];
  readonly output_text?: string;
  readonly status?: string;
  readonly incomplete_details?: { readonly reason?: string };
  readonly usage?: OpenAIUsage;
}

type OpenAIResponsesOutputItem =
  | {
      type: "message";
      role: "assistant";
      content?: Array<
        | { type: "output_text"; text: string }
        | { type: "refusal"; refusal: string }
        | Record<string, unknown>
      >;
    }
  | {
      type: "function_call";
      id?: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  | Record<string, unknown>;

interface OpenAIStreamEvent {
  readonly type?: string;
  readonly response?: OpenAIResponsesResponse;
  readonly item?: Record<string, unknown>;
  readonly delta?: string;
  readonly arguments?: string;
  readonly output_index?: number;
  readonly item_id?: string;
  readonly sequence_number?: number;
}

function getDefaultApiKey(): string | undefined {
  return typeof Bun !== "undefined" ? Bun.env.OPENAI_API_KEY : undefined;
}

function normalizeBaseUrl(baseURL: string): string {
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

function buildHeaders(apiKey: string, stream: boolean): HeadersInit {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(stream ? { accept: "text/event-stream" } : {}),
  };
}

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function encodeResponsesImage(image: Image): OpenAIRequestContentPart {
  if (image.source.type === "base64_image_source") {
    return {
      type: "input_image",
      image_url: dataUrl(image.source.mimeType, image.source.data),
    };
  }
  if (image.source.type === "object_storage_image_source") {
    throw new Error("Object storage image sources must be resolved first");
  }
  return { type: "input_image", image_url: image.source.url };
}

function encodeResponsesDocument(document: Document): OpenAIRequestContentPart {
  switch (document.source.type) {
    case "base64_document_source":
      return {
        type: "input_file",
        file_data: dataUrl(document.source.mediaType, document.source.data),
        filename: "document.pdf",
      };
    case "text_document_source":
      return { type: "input_text", text: document.source.data };
    case "url_document_source":
      throw new Error(
        "OpenAI Responses does not support URL documents directly",
      );
    case "object_storage_document_source":
      throw new Error("Object storage document sources must be resolved first");
  }
}

function encodeResponsesUserContent(
  content: readonly UserContentPart[],
): string | OpenAIRequestContentPart[] {
  const parts: OpenAIRequestContentPart[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push({ type: "input_text", text: part.text });
        break;
      case "image":
        parts.push(encodeResponsesImage(part));
        break;
      case "document":
        parts.push(encodeResponsesDocument(part));
        break;
      case "audio":
        throw new Error("OpenAI provider does not support audio inputs yet");
      case "tool_output":
        break;
    }
  }
  return parts.length === 1 && parts[0]?.type === "input_text"
    ? parts[0].text
    : parts;
}

function encodeResponsesInput(
  messages: readonly Message[],
): OpenAIResponsesInputItem[] {
  const input: OpenAIResponsesInputItem[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      input.push({ role: "system", content: message.content.text });
    } else if (message.role === "user") {
      const toolOutputs = message.content.filter(
        (part) => part.type === "tool_output",
      );
      for (const part of toolOutputs) {
        input.push({
          type: "function_call_output",
          call_id: part.id,
          output: part.result,
        });
      }
      const content = message.content.filter(
        (part) => part.type !== "tool_output",
      );
      if (content.length > 0) {
        input.push({
          role: "user",
          content: encodeResponsesUserContent(content),
        });
      }
    } else {
      for (const part of message.content) {
        if (part.type === "text") {
          input.push({ role: "assistant", content: part.text });
        } else if (part.type === "tool_call") {
          input.push({
            type: "function_call",
            call_id: part.id,
            name: part.name,
            arguments: part.args,
          });
        }
      }
    }
  }

  return input;
}

function encodeTool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  };
}

export function buildOpenAIResponsesRequestBody(
  args: ProviderCallArgs,
): unknown {
  const model = stripProviderPrefix(args.modelId);
  const params: Params | undefined = args.params;
  const body: Record<string, unknown> = {
    model,
    input: encodeResponsesInput(args.messages),
  };
  if (params?.maxTokens !== undefined)
    body.max_output_tokens = params.maxTokens;
  else body.max_output_tokens = DEFAULT_MAX_TOKENS;
  if (params?.temperature !== undefined) body.temperature = params.temperature;
  if (params?.topP !== undefined) body.top_p = params.topP;
  if (params?.stopSequences !== undefined)
    body.stop = [...params.stopSequences];
  if (args.tools && args.tools.length > 0) {
    body.tools = args.tools.map(encodeTool);
  }
  return body;
}

function decodeFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "length":
    case "max_output_tokens":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return "stop";
  }
}

function decodeUsage(usage?: OpenAIUsage): Usage {
  return createUsage({
    tokens: {
      input: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
      output: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
      cacheRead: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  });
}

function decodeResponsesContent(
  response: OpenAIResponsesResponse,
): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];
  for (const item of response.output ?? []) {
    if (item.type === "message") {
      const contents = Array.isArray(item.content) ? item.content : [];
      for (const content of contents) {
        if (
          content.type === "output_text" &&
          typeof content.text === "string"
        ) {
          parts.push({ type: "text", text: content.text });
        }
      }
    } else if (item.type === "function_call") {
      parts.push({
        type: "tool_call",
        id: String(item.call_id),
        name: String(item.name),
        args: String(item.arguments ?? "{}"),
      });
    }
  }
  if (parts.length === 0 && response.output_text) {
    parts.push({ type: "text", text: response.output_text });
  }
  return parts;
}

function decodeResponsesFinishReason(response: OpenAIResponsesResponse) {
  return decodeFinishReason(response.incomplete_details?.reason);
}

function decodeResponsesResponse(
  response: OpenAIResponsesResponse,
  args: ProviderCallArgs,
): LlmResponse {
  return new LlmResponse({
    content: decodeResponsesContent(response),
    usage: decodeUsage(response.usage),
    finishReason: decodeResponsesFinishReason(response),
    rawMessage: response,
    providerId: PROVIDER_ID,
    modelId: args.modelId,
    providerModelName: response.model ?? stripProviderPrefix(args.modelId),
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

async function fetchOpenAIResponses(
  fetchImpl: typeof globalThis.fetch,
  apiKey: string,
  baseURL: string,
  args: ProviderCallArgs,
  stream: boolean,
): Promise<globalThis.Response> {
  const response = await fetchImpl(`${normalizeBaseUrl(baseURL)}/responses`, {
    method: "POST",
    headers: buildHeaders(apiKey, stream),
    body: JSON.stringify({
      ...(buildOpenAIResponsesRequestBody(args) as Record<string, unknown>),
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
    message: "Missing OpenAI API key",
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
): AsyncGenerator<OpenAIStreamEvent> {
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
      if (data && data !== "[DONE]") {
        yield JSON.parse(data) as OpenAIStreamEvent;
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

async function* decodeResponsesStream(
  events: AsyncIterable<OpenAIStreamEvent>,
): AsyncGenerator<StreamResponseChunk> {
  const toolNames = new Map<string, string>();
  const rawOutput: unknown[] = [];
  let textOpen = false;

  for await (const event of events) {
    yield rawStreamEventChunk(event);

    switch (event.type) {
      case "response.output_item.added":
        if (event.item?.type === "function_call") {
          const id = String(event.item.call_id ?? event.item.id ?? "");
          const name = String(event.item.name ?? "");
          toolNames.set(id, name);
          yield toolCallStart(id, name);
        }
        break;
      case "response.output_text.delta":
        if (!textOpen) {
          textOpen = true;
          yield textStart();
        }
        yield textChunk(String(event.delta ?? ""));
        break;
      case "response.output_text.done":
        if (textOpen) {
          textOpen = false;
          yield textEnd();
        }
        break;
      case "response.function_call_arguments.delta": {
        const id = String(event.item_id ?? "");
        yield toolCallChunk(id, String(event.delta ?? event.arguments ?? ""));
        break;
      }
      case "response.output_item.done":
        if (event.item) rawOutput.push(event.item);
        if (event.item?.type === "function_call") {
          const id = String(event.item.call_id ?? event.item.id ?? "");
          yield toolCallEnd(id);
        }
        break;
      case "response.completed":
        if (event.response?.usage) {
          yield usageDeltaChunk({
            inputTokens: event.response.usage.input_tokens ?? 0,
            outputTokens: event.response.usage.output_tokens ?? 0,
          });
        }
        yield finishReasonChunk(
          event.response ? decodeResponsesFinishReason(event.response) : "stop",
        );
        yield rawMessageChunk(event.response ?? { output: rawOutput });
        break;
    }
  }
}

export function makeOpenAIResponsesProvider(
  options: OpenAIProviderOptions = {},
): ProviderService {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseURL = options.baseURL ?? DEFAULT_BASE_URL;

  return {
    id: PROVIDER_ID,
    call: (args) =>
      Effect.tryPromise({
        try: async () => {
          const apiKey = requireApiKey(options.apiKey ?? getDefaultApiKey());
          const response = await fetchOpenAIResponses(
            fetchImpl,
            apiKey,
            baseURL,
            args,
            false,
          );
          return decodeResponsesResponse(
            (await response.json()) as OpenAIResponsesResponse,
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
            const response = await fetchOpenAIResponses(
              fetchImpl,
              apiKey,
              baseURL,
              args,
              true,
            );
            return Stream.fromAsyncIterable(
              decodeResponsesStream(parseSseEvents(response)),
              wrapUnknownError,
            );
          },
          catch: wrapUnknownError,
        }),
      ),
  };
}

export function OpenAIResponsesProvider(
  options: OpenAIProviderOptions = {},
): Layer.Layer<Provider> {
  return Layer.succeed(Provider, makeOpenAIResponsesProvider(options));
}

export const makeOpenAIProvider = makeOpenAIResponsesProvider;
export const OpenAIProvider = OpenAIResponsesProvider;
