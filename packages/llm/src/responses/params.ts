import { Schema } from "effect";

export const ThinkingConfig = Schema.Struct({
  level: Schema.optional(
    Schema.Literal("minimal", "low", "medium", "high", "extra-high"),
  ),
  budgetTokens: Schema.optional(Schema.Number),
  encodeThoughtsAsText: Schema.optional(Schema.Boolean),
});
export type ThinkingConfig = typeof ThinkingConfig.Type;

export const Params = Schema.Struct({
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stopSequences: Schema.optional(Schema.Array(Schema.String)),
  thinking: Schema.optional(Schema.NullOr(ThinkingConfig)),
});
export type Params = typeof Params.Type;
