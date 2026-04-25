/**
 * Effect Schema → JSON Schema conversion for tool parameters.
 */
import type { ToolParameterSchema } from "./tool-schema.ts";
import { JSONSchema, type Schema } from "effect";

export function schemaToJsonSchema<A, I, R>(
  schema: Schema.Schema<A, I, R>,
  options?: { strict?: boolean },
): ToolParameterSchema {
  const raw = JSONSchema.make(schema) as unknown as Record<string, unknown>;

  const properties = (raw.properties ??
    {}) as ToolParameterSchema["properties"];
  const required = (raw.required ?? []) as readonly string[];
  const strict = options?.strict ?? true;

  const result: ToolParameterSchema = {
    type: "object",
    properties,
    required,
    additionalProperties: !strict,
  };

  if (raw.$defs) {
    return { ...result, $defs: raw.$defs as ToolParameterSchema["$defs"] };
  }

  return result;
}
