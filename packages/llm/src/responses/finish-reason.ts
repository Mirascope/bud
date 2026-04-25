import { Schema } from "effect";

export const FinishReason = Schema.Literal(
  "stop",
  "tool_use",
  "max_tokens",
  "refusal",
  "context_length_exceeded",
);
export type FinishReason = typeof FinishReason.Type;
