import * as LLM from "@bud/llm";
import { Effect, Stream } from "effect";

export interface ProviderProxyOptions {
  readonly id: string;
  readonly stream: (args: LLM.ProviderCallArgs) => Promise<Response>;
}

interface ProviderProxyStreamError {
  readonly message: string;
  readonly kind: LLM.ProviderErrorKind;
  readonly providerId: string;
  readonly statusCode?: number;
}

export const ProviderProxy = {
  make: (options: ProviderProxyOptions): LLM.ProviderService => ({
    id: options.id,
    call: () =>
      Effect.fail(
        new LLM.ProviderError({
          message: "ProviderProxy only supports streaming calls.",
          providerId: options.id,
          kind: "invalid_request",
        }),
      ),
    stream: (args) =>
      Stream.unwrap(
        Effect.tryPromise({
          try: async () => {
            const response = await options.stream(args);
            if (!response.ok) {
              throw new LLM.ProviderError({
                message: await response.text(),
                providerId: options.id,
                kind: "server_error",
                statusCode: response.status,
              });
            }
            if (!response.body) {
              throw new LLM.ProviderError({
                message: "Provider proxy returned an empty stream.",
                providerId: options.id,
                kind: "server_error",
              });
            }

            return Stream.fromAsyncIterable(
              decodeProviderStream(response.body),
              (error) => toProviderError(error, options.id),
            );
          },
          catch: (error) => toProviderError(error, options.id),
        }),
      ),
  }),
};

async function* decodeProviderStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<LLM.StreamResponseChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = findSseBoundary(buffer);
    while (boundary) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const chunk = decodeProviderStreamFrame(frame);
      if (chunk) yield chunk;
      boundary = findSseBoundary(buffer);
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) {
    const chunk = decodeProviderStreamFrame(tail);
    if (chunk) yield chunk;
  }
}

function findSseBoundary(
  value: string,
): { readonly index: number; readonly length: number } | null {
  const windows = ["\r\n\r\n", "\n\n", "\r\r"];
  let best: { index: number; length: number } | null = null;
  for (const boundary of windows) {
    const index = value.indexOf(boundary);
    if (index !== -1 && (!best || index < best.index)) {
      best = { index, length: boundary.length };
    }
  }
  return best;
}

function decodeProviderStreamFrame(
  frame: string,
): LLM.StreamResponseChunk | null {
  let event = "message";
  const data: string[] = [];

  for (const rawLine of frame.split(/\r?\n|\r/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }

  if (data.length === 0) return null;
  const payload = JSON.parse(data.join("\n")) as unknown;
  if (event === "chunk") return payload as LLM.StreamResponseChunk;
  if (event !== "error") return null;
  const error = payload as ProviderProxyStreamError;
  throw new LLM.ProviderError({
    message: error.message,
    providerId: error.providerId,
    kind: error.kind,
    statusCode: error.statusCode,
  });
}

function toProviderError(
  error: unknown,
  providerId: string,
): LLM.ProviderError {
  if (error instanceof LLM.ProviderError) return error;
  if (LLM.isProviderErrorLike(error)) {
    return new LLM.ProviderError({
      message: error.message,
      providerId: error.providerId ?? providerId,
      kind: error.kind as LLM.ProviderErrorKind,
      statusCode: error.statusCode,
    });
  }
  return new LLM.ProviderError({
    message: error instanceof Error ? error.message : String(error),
    providerId,
    kind: "unknown",
  });
}
