/**
 * Thought content from an assistant's extended thinking.
 *
 * Represents the reasoning process of models that support
 * extended thinking (e.g., Claude with thinking enabled).
 */
import { Schema } from "effect";

/** Thought/reasoning content in an assistant message. */
export const Thought = Schema.Struct({
  type: Schema.Literal("thought"),
  /** The thoughts or reasoning of the assistant. */
  thought: Schema.String,
});
export type Thought = typeof Thought.Type;

// ---------------------------------------------------------------------------
// Streaming chunks
// ---------------------------------------------------------------------------

/** Signals the start of a thought content block in the stream. */
export const ThoughtStartChunk = Schema.Struct({
  type: Schema.Literal("thought_start_chunk"),
  contentType: Schema.Literal("thought"),
});
export type ThoughtStartChunk = typeof ThoughtStartChunk.Type;

/** Contains incremental thought content. */
export const ThoughtChunk = Schema.Struct({
  type: Schema.Literal("thought_chunk"),
  contentType: Schema.Literal("thought"),
  /** The incremental thought text added in this chunk. */
  delta: Schema.String,
});
export type ThoughtChunk = typeof ThoughtChunk.Type;

/** Signals the end of a thought content block in the stream. */
export const ThoughtEndChunk = Schema.Struct({
  type: Schema.Literal("thought_end_chunk"),
  contentType: Schema.Literal("thought"),
});
export type ThoughtEndChunk = typeof ThoughtEndChunk.Type;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export const thoughtStart = (): ThoughtStartChunk => ({
  type: "thought_start_chunk",
  contentType: "thought",
});

export const thoughtChunk = (delta: string): ThoughtChunk => ({
  type: "thought_chunk",
  contentType: "thought",
  delta,
});

export const thoughtEnd = (): ThoughtEndChunk => ({
  type: "thought_end_chunk",
  contentType: "thought",
});
