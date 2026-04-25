/**
 * Message types for LLM conversations.
 */
import {
  AssistantContentPart,
  Text,
  UserContentPart,
} from "../content/index.ts";
import { Schema } from "effect";

export const SystemMessage = Schema.Struct({
  role: Schema.Literal("system"),
  content: Text,
});
export type SystemMessage = typeof SystemMessage.Type;

export const UserMessage = Schema.Struct({
  role: Schema.Literal("user"),
  content: Schema.Array(UserContentPart),
  name: Schema.NullOr(Schema.String),
});
export type UserMessage = typeof UserMessage.Type;

export const AssistantMessage = Schema.Struct({
  role: Schema.Literal("assistant"),
  content: Schema.Array(AssistantContentPart),
  name: Schema.NullOr(Schema.String),
  providerId: Schema.NullOr(Schema.String),
  modelId: Schema.NullOr(Schema.String),
  providerModelName: Schema.NullOr(Schema.String),
  rawMessage: Schema.NullOr(Schema.Unknown),
});
export type AssistantMessage = typeof AssistantMessage.Type;

export const Message = Schema.Union(
  SystemMessage,
  UserMessage,
  AssistantMessage,
);
export type Message = typeof Message.Type;

// Convenience constructors

export function system(text: string): SystemMessage {
  return { role: "system", content: { type: "text", text } };
}

export function user(
  content: string | readonly UserContentPart[],
  name?: string,
): UserMessage {
  const parts =
    typeof content === "string"
      ? [{ type: "text" as const, text: content }]
      : [...content];
  return { role: "user", content: parts, name: name ?? null };
}

export function assistant(
  content: string | readonly AssistantContentPart[],
  options?: {
    name?: string;
    providerId?: string;
    modelId?: string;
    providerModelName?: string;
    rawMessage?: unknown;
  },
): AssistantMessage {
  const parts =
    typeof content === "string"
      ? [{ type: "text" as const, text: content }]
      : [...content];
  return {
    role: "assistant",
    content: parts,
    name: options?.name ?? null,
    providerId: options?.providerId ?? null,
    modelId: options?.modelId ?? null,
    providerModelName: options?.providerModelName ?? null,
    rawMessage: options?.rawMessage ?? null,
  };
}
