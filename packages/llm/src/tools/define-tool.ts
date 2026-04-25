/**
 * Tool definition using Effect Schema.
 */
import type { ToolResult } from "../content/tool-output.ts";
import { schemaToJsonSchema } from "./json-schema.ts";
import type { ToolParameterSchema } from "./tool-schema.ts";
import { Effect, Schema } from "effect";

export interface Tool<A = unknown, E = unknown, R = never> {
  readonly _tag: "Tool";
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameterSchema;
  readonly strict: boolean;
  readonly schema: Schema.Schema<A, unknown>;
  readonly execute: (args: A) => Effect.Effect<ToolResult, E, R>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any, unknown, any>;

export interface DefineToolArgs<S extends Schema.Schema.Any, E, R> {
  name: string;
  description: string;
  schema: S;
  strict?: boolean;
  tool: (
    args: Schema.Schema.Type<S>,
  ) => Effect.Effect<ToolResult, E, R> | ToolResult | Promise<ToolResult>;
}

export function defineTool<S extends Schema.Schema.Any, E = never, R = never>(
  args: DefineToolArgs<S, E, R>,
): Tool<Schema.Schema.Type<S>, E, R> {
  type A = Schema.Schema.Type<S>;

  const parameters = schemaToJsonSchema(args.schema, { strict: args.strict });
  const decode = Schema.decodeUnknown(args.schema);

  const execute = (rawArgs: A): Effect.Effect<ToolResult, E, R> => {
    return Effect.gen(function* () {
      const validatedArgs = yield* decode(rawArgs) as Effect.Effect<A>;
      const result = args.tool(validatedArgs);
      if (Effect.isEffect(result)) {
        return yield* result as Effect.Effect<ToolResult, E, R>;
      }
      if (result instanceof Promise) {
        return yield* Effect.promise(() => result);
      }
      return result;
    }) as Effect.Effect<ToolResult, E, R>;
  };

  return {
    _tag: "Tool",
    name: args.name,
    description: args.description,
    parameters,
    strict: args.strict ?? true,
    schema: args.schema as unknown as Schema.Schema<A, unknown>,
    execute,
  };
}
