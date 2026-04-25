/**
 * Tool call content from an assistant message.
 *
 * Represents a request from the assistant to call a tool/function.
 */
import { Schema } from "effect";

/** A tool call in an assistant message. */
export const ToolCall = Schema.Struct({
  type: Schema.Literal("tool_call"),
  /** A unique identifier for this tool call. */
  id: Schema.String,
  /** The name of the tool to call. */
  name: Schema.String,
  /** The arguments to pass to the tool, as stringified JSON. */
  args: Schema.String,
  /** Opaque thought signature for Google thinking model round-trips (base64). */
  thoughtSignature: Schema.optional(Schema.String),
});
export type ToolCall = typeof ToolCall.Type;

// ---------------------------------------------------------------------------
// Streaming chunks
// ---------------------------------------------------------------------------

export const ToolCallStartChunk = Schema.Struct({
  type: Schema.Literal("tool_call_start_chunk"),
  contentType: Schema.Literal("tool_call"),
  id: Schema.String,
  name: Schema.String,
  thoughtSignature: Schema.optional(Schema.String),
});
export type ToolCallStartChunk = typeof ToolCallStartChunk.Type;

export const ToolCallChunk = Schema.Struct({
  type: Schema.Literal("tool_call_chunk"),
  contentType: Schema.Literal("tool_call"),
  id: Schema.String,
  delta: Schema.String,
});
export type ToolCallChunk = typeof ToolCallChunk.Type;

export const ToolCallEndChunk = Schema.Struct({
  type: Schema.Literal("tool_call_end_chunk"),
  contentType: Schema.Literal("tool_call"),
  id: Schema.String,
});
export type ToolCallEndChunk = typeof ToolCallEndChunk.Type;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export const toolCallStart = (
  id: string,
  name: string,
  thoughtSignature?: string,
): ToolCallStartChunk => ({
  type: "tool_call_start_chunk",
  contentType: "tool_call",
  id,
  name,
  ...(thoughtSignature ? { thoughtSignature } : {}),
});

export const toolCallChunk = (id: string, delta: string): ToolCallChunk => ({
  type: "tool_call_chunk",
  contentType: "tool_call",
  id,
  delta,
});

export const toolCallEnd = (id: string): ToolCallEndChunk => ({
  type: "tool_call_end_chunk",
  contentType: "tool_call",
  id,
});
