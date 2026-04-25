/**
 * Text content for messages.
 *
 * Represents plain text content — the most common content type
 * for both user and assistant messages.
 */
import { Schema } from "effect";

/** Text content in a message. */
export const Text = Schema.Struct({
  type: Schema.Literal("text"),
  /** The text content. */
  text: Schema.String,
});
export type Text = typeof Text.Type;

// ---------------------------------------------------------------------------
// Streaming chunks
// ---------------------------------------------------------------------------

/** Signals the start of a text content block in the stream. */
export const TextStartChunk = Schema.Struct({
  type: Schema.Literal("text_start_chunk"),
  contentType: Schema.Literal("text"),
});
export type TextStartChunk = typeof TextStartChunk.Type;

/** Contains incremental text content. */
export const TextChunk = Schema.Struct({
  type: Schema.Literal("text_chunk"),
  contentType: Schema.Literal("text"),
  /** The incremental text added in this chunk. */
  delta: Schema.String,
});
export type TextChunk = typeof TextChunk.Type;

/** Signals the end of a text content block in the stream. */
export const TextEndChunk = Schema.Struct({
  type: Schema.Literal("text_end_chunk"),
  contentType: Schema.Literal("text"),
});
export type TextEndChunk = typeof TextEndChunk.Type;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export const textStart = (): TextStartChunk => ({
  type: "text_start_chunk",
  contentType: "text",
});

export const textChunk = (delta: string): TextChunk => ({
  type: "text_chunk",
  contentType: "text",
  delta,
});

export const textEnd = (): TextEndChunk => ({
  type: "text_end_chunk",
  contentType: "text",
});
