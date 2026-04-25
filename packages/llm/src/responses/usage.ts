/**
 * Usage schemas — token + tool usage.
 */
import { Schema } from "effect";

export const ToolUsageSchema = Schema.Struct({
  type: Schema.String,
  count: Schema.Number,
  durationSeconds: Schema.optional(Schema.Number),
});
export type ToolUsage = typeof ToolUsageSchema.Type;

export const TokenUsageSchema = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  reasoning: Schema.optionalWith(Schema.Number, { default: () => 0 }),
});
export type TokenUsage = typeof TokenUsageSchema.Type;

export const UsageSchema = Schema.Struct({
  tokens: TokenUsageSchema,
  tools: Schema.optionalWith(Schema.Array(ToolUsageSchema), {
    default: () => [],
  }),
});
export type Usage = typeof UsageSchema.Type;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createUsage(
  options: {
    tokens?: Partial<TokenUsage>;
    tools?: ToolUsage[];
  } = {},
): Usage {
  return {
    tokens: {
      input: options.tokens?.input ?? 0,
      output: options.tokens?.output ?? 0,
      cacheRead: options.tokens?.cacheRead ?? 0,
      cacheWrite: options.tokens?.cacheWrite ?? 0,
      reasoning: options.tokens?.reasoning ?? 0,
    },
    tools: options.tools ?? [],
  };
}

export function totalTokens(usage: Usage): number {
  return usage.tokens.input + usage.tokens.output;
}
