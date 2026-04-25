import { Schema } from "effect";

export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: readonly (string | number | boolean)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
  default?: unknown;
  $ref?: string;
  oneOf?: readonly JsonSchemaProperty[];
  allOf?: readonly JsonSchemaProperty[];
  anyOf?: readonly JsonSchemaProperty[];
}

export const ToolParameterSchema = Schema.Struct({
  type: Schema.Literal("object"),
  properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  required: Schema.Array(Schema.String),
  additionalProperties: Schema.Boolean,
  $defs: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type ToolParameterSchema = typeof ToolParameterSchema.Type;

export const ToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: ToolParameterSchema,
  strict: Schema.optional(Schema.Boolean),
});
export type ToolSchema = typeof ToolSchema.Type;
