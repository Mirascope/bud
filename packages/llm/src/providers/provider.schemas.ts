import { Message } from "../messages/message.ts";
import type { StreamResponseChunk } from "../responses/chunks.ts";
import { Params } from "../responses/params.ts";
import type { Response } from "../responses/response.ts";
import { ToolSchema } from "../tools/tool-schema.ts";
import { Context, type Effect, Schema, type Stream } from "effect";

/** Strip the provider prefix from a model ID. "anthropic/claude-..." → "claude-..." */
export function stripProviderPrefix(modelId: string): string {
  return modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
}

export const ProviderCallArgs = Schema.Struct({
  modelId: Schema.String,
  messages: Schema.Array(Message),
  tools: Schema.optional(Schema.Array(ToolSchema)),
  params: Schema.optional(Params),
});
export type ProviderCallArgs = typeof ProviderCallArgs.Type;

export const ProviderErrorKind = Schema.Literal(
  "rate_limit",
  "auth",
  "context_overflow",
  "invalid_request",
  "server_error",
  "budget",
  "unknown",
);
export type ProviderErrorKind = typeof ProviderErrorKind.Type;

export class ProviderError extends Schema.TaggedError<ProviderError>()(
  "ProviderError",
  {
    message: Schema.String,
    providerId: Schema.String,
    kind: ProviderErrorKind,
    statusCode: Schema.optional(Schema.Number),
    retryAfter: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export function isProviderErrorLike(value: unknown): value is {
  _tag: "ProviderError";
  message: string;
  kind: string;
  statusCode?: number;
  providerId?: string;
} {
  return (
    value != null &&
    typeof value === "object" &&
    "_tag" in value &&
    (value as { _tag: unknown })._tag === "ProviderError" &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string" &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

/** The contract all LLM providers implement. */
export interface ProviderService {
  readonly id: string;
  readonly call: (
    args: ProviderCallArgs,
  ) => Effect.Effect<Response, ProviderError>;
  readonly stream: (
    args: ProviderCallArgs,
  ) => Stream.Stream<StreamResponseChunk, ProviderError>;
}

export class Provider extends Context.Tag("@bud/llm/Provider")<
  Provider,
  ProviderService
>() {}
