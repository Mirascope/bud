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
  buildOpenAIHeaders,
  getDefaultOpenAIApiKey,
  normalizeOpenAIBaseUrl,
  openAIDataUrl,
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MAX_TOKENS,
  OPENAI_PROVIDER_ID,
  openAIProviderErrorKind,
  parseOpenAIErrorMessage,
  parseOpenAISseEvents,
  requireOpenAIApiKey,
  wrapOpenAIUnknownError,
  type OpenAIProviderEndpointOptions,
  type OpenAIUsage,
} from "./provider.openai.shared.ts";
import {
  Provider,
  ProviderError,
  stripProviderPrefix,
  type ProviderCallArgs,
  type ProviderService,
} from "./provider.schemas.ts";
import { Effect, Layer, Stream } from "effect";

type OpenAIChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { file_data?: string; filename?: string } };

type OpenAIChatMessage =
  | {
      role: "system" | "user" | "assistant";
      content?: string | OpenAIChatContentPart[];
      tool_calls?: OpenAIChatToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

interface OpenAIChatToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

interface OpenAIChatResponse {
  readonly id: string;
  readonly model: string;
  readonly choices: Array<{
    readonly message: {
      readonly role: "assistant";
      readonly content?: string | null;
      readonly tool_calls?: OpenAIChatToolCall[];
    };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: OpenAIUsage;
}

interface OpenAIChatStreamEvent {
  readonly choices?: Array<{
    readonly delta?: {
      readonly content?: string | null;
      readonly tool_calls?: Array<{
        readonly index: number;
        readonly id?: string;
        readonly type?: "function";
        readonly function?: {
          readonly name?: string;
          readonly arguments?: string;
        };
      }>;
    };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: OpenAIUsage | null;
}

function encodeImage(image: Image): OpenAIChatContentPart {
  if (image.source.type === "base64_image_source") {
    return {
      type: "image_url",
      image_url: {
        url: openAIDataUrl(image.source.mimeType, image.source.data),
      },
    };
  }
  if (image.source.type === "object_storage_image_source") {
    throw new Error("Object storage image sources must be resolved first");
  }
  return { type: "image_url", image_url: { url: image.source.url } };
}

function encodeDocument(document: Document): OpenAIChatContentPart {
  switch (document.source.type) {
    case "base64_document_source":
      return {
        type: "file",
        file: {
          file_data: openAIDataUrl(
            document.source.mediaType,
            document.source.data,
          ),
          filename: "document.pdf",
        },
      };
    case "text_document_source":
      return { type: "text", text: document.source.data };
    case "url_document_source":
      throw new Error(
        "OpenAI Chat Completions does not support URL documents directly",
      );
    case "object_storage_document_source":
      throw new Error("Object storage document sources must be resolved first");
  }
}

function encodeUserContent(
  content: readonly UserContentPart[],
): string | OpenAIChatContentPart[] {
  const parts: OpenAIChatContentPart[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push({ type: "text", text: part.text });
        break;
      case "image":
        parts.push(encodeImage(part));
        break;
      case "document":
        parts.push(encodeDocument(part));
        break;
      case "audio":
        throw new Error("OpenAI provider does not support audio inputs yet");
      case "tool_output":
        break;
    }
  }
  return parts.length === 1 && parts[0]?.type === "text"
    ? parts[0].text
    : parts;
}

function encodeMessages(messages: readonly Message[]): OpenAIChatMessage[] {
  const encoded: OpenAIChatMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      encoded.push({ role: "system", content: message.content.text });
    } else if (message.role === "user") {
      const normalContent = message.content.filter(
        (part) => part.type !== "tool_output",
      );
      if (normalContent.length > 0) {
        encoded.push({
          role: "user",
          content: encodeUserContent(normalContent),
        });
      }
      for (const part of message.content) {
        if (part.type === "tool_output") {
          encoded.push({
            role: "tool",
            tool_call_id: part.id,
            content: part.result,
          });
        }
      }
    } else {
      const content = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      const toolCalls = message.content
        .filter((part) => part.type === "tool_call")
        .map(
          (part): OpenAIChatToolCall => ({
            id: part.id,
            type: "function",
            function: { name: part.name, arguments: part.args },
          }),
        );
      encoded.push({
        role: "assistant",
        ...(content ? { content } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    }
  }

  return encoded;
}

function encodeTool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  };
}

export function buildOpenAIChatCompletionsRequestBody(
  args: ProviderCallArgs,
): unknown {
  const model = stripProviderPrefix(args.modelId);
  const params: Params | undefined = args.params;
  const body: Record<string, unknown> = {
    model,
    messages: encodeMessages(args.messages),
  };
  if (params?.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  else body.max_tokens = OPENAI_DEFAULT_MAX_TOKENS;
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
      input: usage?.prompt_tokens ?? 0,
      output: usage?.completion_tokens ?? 0,
      cacheRead: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  });
}

function decodeContent(response: OpenAIChatResponse): AssistantContentPart[] {
  const message = response.choices[0]?.message;
  const parts: AssistantContentPart[] = [];
  if (message?.content) {
    parts.push({ type: "text", text: message.content });
  }
  for (const call of message?.tool_calls ?? []) {
    parts.push({
      type: "tool_call",
      id: call.id,
      name: call.function.name,
      args: call.function.arguments,
    });
  }
  return parts;
}

function decodeResponse(
  response: OpenAIChatResponse,
  args: ProviderCallArgs,
): LlmResponse {
  return new LlmResponse({
    content: decodeContent(response),
    usage: decodeUsage(response.usage),
    finishReason: decodeFinishReason(response.choices[0]?.finish_reason),
    rawMessage: response.choices[0]?.message ?? response,
    providerId: OPENAI_PROVIDER_ID,
    modelId: args.modelId,
    providerModelName: response.model ?? stripProviderPrefix(args.modelId),
    inputMessages: [...args.messages],
    tools: [],
    toolSchemas: args.tools ? [...args.tools] : [],
  });
}

async function fetchOpenAIChatCompletions(
  fetchImpl: typeof globalThis.fetch,
  apiKey: string,
  baseURL: string,
  args: ProviderCallArgs,
  stream: boolean,
): Promise<globalThis.Response> {
  const response = await fetchImpl(
    `${normalizeOpenAIBaseUrl(baseURL)}/chat/completions`,
    {
      method: "POST",
      headers: buildOpenAIHeaders(apiKey, stream),
      body: JSON.stringify({
        ...(buildOpenAIChatCompletionsRequestBody(args) as Record<
          string,
          unknown
        >),
        ...(stream
          ? { stream: true, stream_options: { include_usage: true } }
          : {}),
      }),
    },
  );

  if (!response.ok) {
    throw new ProviderError({
      message: await parseOpenAIErrorMessage(response),
      providerId: OPENAI_PROVIDER_ID,
      kind: openAIProviderErrorKind(response.status),
      statusCode: response.status,
    });
  }

  return response;
}

async function* decodeStream(
  events: AsyncIterable<OpenAIChatStreamEvent>,
): AsyncGenerator<StreamResponseChunk> {
  const toolCalls = new Map<
    number,
    { id: string; name: string; arguments: string; started: boolean }
  >();
  let textOpen = false;
  let text = "";
  const rawToolCalls: OpenAIChatToolCall[] = [];

  for await (const event of events) {
    yield rawStreamEventChunk(event);
    if (event.usage) {
      yield usageDeltaChunk({
        inputTokens: event.usage.prompt_tokens ?? 0,
        outputTokens: event.usage.completion_tokens ?? 0,
      });
    }

    const choice = event.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) {
      if (!textOpen) {
        textOpen = true;
        yield textStart();
      }
      text += delta.content;
      yield textChunk(delta.content);
    }

    for (const partial of delta?.tool_calls ?? []) {
      const state = toolCalls.get(partial.index) ?? {
        id: partial.id ?? `call_${partial.index}`,
        name: partial.function?.name ?? "",
        arguments: "",
        started: false,
      };
      if (partial.id) state.id = partial.id;
      if (partial.function?.name) state.name = partial.function.name;
      if (!state.started && state.name) {
        state.started = true;
        yield toolCallStart(state.id, state.name);
      }
      if (partial.function?.arguments) {
        state.arguments += partial.function.arguments;
        yield toolCallChunk(state.id, partial.function.arguments);
      }
      toolCalls.set(partial.index, state);
    }

    if (choice?.finish_reason) {
      if (textOpen) {
        textOpen = false;
        yield textEnd();
      }
      for (const state of toolCalls.values()) {
        rawToolCalls.push({
          id: state.id,
          type: "function",
          function: { name: state.name, arguments: state.arguments },
        });
        yield toolCallEnd(state.id);
      }
      yield finishReasonChunk(decodeFinishReason(choice.finish_reason));
    }
  }

  yield rawMessageChunk({
    role: "assistant",
    content: text || null,
    tool_calls: rawToolCalls.length > 0 ? rawToolCalls : undefined,
  });
}

export function makeOpenAIChatCompletionsProvider(
  options: OpenAIProviderEndpointOptions = {},
): ProviderService {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseURL = options.baseURL ?? OPENAI_DEFAULT_BASE_URL;

  return {
    id: OPENAI_PROVIDER_ID,
    call: (args) =>
      Effect.tryPromise({
        try: async () => {
          const apiKey = requireOpenAIApiKey(
            options.apiKey ?? getDefaultOpenAIApiKey(),
          );
          const response = await fetchOpenAIChatCompletions(
            fetchImpl,
            apiKey,
            baseURL,
            args,
            false,
          );
          return decodeResponse(
            (await response.json()) as OpenAIChatResponse,
            args,
          );
        },
        catch: wrapOpenAIUnknownError,
      }),
    stream: (args) =>
      Stream.unwrap(
        Effect.tryPromise({
          try: async () => {
            const apiKey = requireOpenAIApiKey(
              options.apiKey ?? getDefaultOpenAIApiKey(),
            );
            const response = await fetchOpenAIChatCompletions(
              fetchImpl,
              apiKey,
              baseURL,
              args,
              true,
            );
            return Stream.fromAsyncIterable(
              decodeStream(
                parseOpenAISseEvents<OpenAIChatStreamEvent>(response),
              ),
              wrapOpenAIUnknownError,
            );
          },
          catch: wrapOpenAIUnknownError,
        }),
      ),
  };
}

export function OpenAIChatCompletionsProvider(
  options: OpenAIProviderEndpointOptions = {},
): Layer.Layer<Provider> {
  return Layer.succeed(Provider, makeOpenAIChatCompletionsProvider(options));
}
