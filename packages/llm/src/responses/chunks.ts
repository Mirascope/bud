/**
 * Streaming chunk types for provider-agnostic streaming responses.
 */
import { TextStartChunk, TextChunk, TextEndChunk } from "../content/text.ts";
import {
  ThoughtStartChunk,
  ThoughtChunk,
  ThoughtEndChunk,
} from "../content/thought.ts";
import {
  ToolCallStartChunk,
  ToolCallChunk,
  ToolCallEndChunk,
} from "../content/tool-call.ts";
import { FinishReason } from "./finish-reason.ts";
import { Schema } from "effect";

export const FinishReasonChunk = Schema.Struct({
  type: Schema.Literal("finish_reason_chunk"),
  finishReason: FinishReason,
});
export type FinishReasonChunk = typeof FinishReasonChunk.Type;

export const UsageDeltaChunk = Schema.Struct({
  type: Schema.Literal("usage_delta_chunk"),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  reasoningTokens: Schema.Number,
});
export type UsageDeltaChunk = typeof UsageDeltaChunk.Type;

export const RawStreamEventChunk = Schema.Struct({
  type: Schema.Literal("raw_stream_event_chunk"),
  rawStreamEvent: Schema.Unknown,
});
export type RawStreamEventChunk = typeof RawStreamEventChunk.Type;

export const RawMessageChunk = Schema.Struct({
  type: Schema.Literal("raw_message_chunk"),
  rawMessage: Schema.Unknown,
});
export type RawMessageChunk = typeof RawMessageChunk.Type;

export const AssistantContentChunk = Schema.Union(
  TextStartChunk,
  TextChunk,
  TextEndChunk,
  ThoughtStartChunk,
  ThoughtChunk,
  ThoughtEndChunk,
  ToolCallStartChunk,
  ToolCallChunk,
  ToolCallEndChunk,
);
export type AssistantContentChunk = typeof AssistantContentChunk.Type;

export const StreamResponseChunk = Schema.Union(
  TextStartChunk,
  TextChunk,
  TextEndChunk,
  ThoughtStartChunk,
  ThoughtChunk,
  ThoughtEndChunk,
  ToolCallStartChunk,
  ToolCallChunk,
  ToolCallEndChunk,
  FinishReasonChunk,
  UsageDeltaChunk,
  RawStreamEventChunk,
  RawMessageChunk,
);
export type StreamResponseChunk = typeof StreamResponseChunk.Type;

// Factory helpers

export const finishReasonChunk = (
  finishReason: FinishReason,
): FinishReasonChunk => ({
  type: "finish_reason_chunk",
  finishReason,
});

export const usageDeltaChunk = (usage: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}): UsageDeltaChunk => ({
  type: "usage_delta_chunk",
  inputTokens: usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  reasoningTokens: usage.reasoningTokens ?? 0,
});

export const rawStreamEventChunk = (
  rawStreamEvent: unknown,
): RawStreamEventChunk => ({
  type: "raw_stream_event_chunk",
  rawStreamEvent,
});

export const rawMessageChunk = (rawMessage: unknown): RawMessageChunk => ({
  type: "raw_message_chunk",
  rawMessage,
});
