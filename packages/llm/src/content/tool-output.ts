/**
 * Tool output content representing the result of a tool call.
 *
 * Every tool_output carries an optional `usage` record so session-level
 * aggregators can sum LLM-turn and tool-call costs uniformly.
 */
import { UsageSchema, type Usage } from "../responses/usage.ts";
import { Document } from "./document.ts";
import { Image } from "./image.ts";
import { Schema } from "effect";

/** Zero-usage placeholder for tools that don't meter. */
export const ZERO_USAGE: Usage = {
  tokens: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    costCenticents: 0,
  },
  tools: [],
  costCenticents: 0,
};

export const ToolOutput = Schema.Struct({
  type: Schema.Literal("tool_output"),
  id: Schema.String,
  name: Schema.String,
  result: Schema.String,
  isError: Schema.Boolean,
  usage: Schema.optional(UsageSchema),
});
export type ToolOutput = typeof ToolOutput.Type;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function toolOutputSuccess(
  id: string,
  name: string,
  result: unknown,
  usage: Usage = ZERO_USAGE,
): ToolOutput {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return { type: "tool_output", id, name, result: text, isError: false, usage };
}

export function toolOutputFailure(
  id: string,
  name: string,
  error: Error,
  usage: Usage = ZERO_USAGE,
): ToolOutput {
  return {
    type: "tool_output",
    id,
    name,
    result: error.message,
    isError: true,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Rich tool results
// ---------------------------------------------------------------------------

export type ToolResultContentPart = typeof Document.Type | typeof Image.Type;

export const ToolResult = Schema.TaggedStruct("ToolResult", {
  result: Schema.Unknown,
  usage: UsageSchema,
  content: Schema.optional(Schema.Array(Schema.Union(Document, Image))),
});
export type ToolResult = typeof ToolResult.Type;

export function toolResult(
  result: unknown,
  usage: Usage = ZERO_USAGE,
  content?: readonly ToolResultContentPart[],
): ToolResult {
  return {
    _tag: "ToolResult",
    result,
    usage,
    ...(content !== undefined ? { content: [...content] } : {}),
  };
}
