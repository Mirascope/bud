import { ProviderError } from "./provider.schemas.ts";

export const OPENAI_PROVIDER_ID = "openai";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_MAX_TOKENS = 4096;

export interface OpenAIProviderEndpointOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface OpenAIUsage {
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

export function getDefaultOpenAIApiKey(): string | undefined {
  return typeof Bun !== "undefined" ? Bun.env.OPENAI_API_KEY : undefined;
}

export function normalizeOpenAIBaseUrl(baseURL: string): string {
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

export function buildOpenAIHeaders(
  apiKey: string,
  stream: boolean,
): HeadersInit {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(stream ? { accept: "text/event-stream" } : {}),
  };
}

export function requireOpenAIApiKey(apiKey: string | undefined): string {
  if (apiKey) return apiKey;
  throw new ProviderError({
    message: "Missing OpenAI API key",
    providerId: OPENAI_PROVIDER_ID,
    kind: "auth",
  });
}

export function openAIProviderErrorKind(status: number): ProviderError["kind"] {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 400) return "invalid_request";
  if (status === 500 || status === 502 || status === 503) {
    return "server_error";
  }
  return "unknown";
}

export async function parseOpenAIErrorMessage(
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

export function wrapOpenAIUnknownError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError({
    message: error instanceof Error ? error.message : String(error),
    providerId: OPENAI_PROVIDER_ID,
    kind: "unknown",
    cause: error,
  });
}

export async function* parseOpenAISseEvents<T>(
  response: globalThis.Response,
): AsyncGenerator<T> {
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
        yield JSON.parse(data) as T;
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

export function openAIDataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}
