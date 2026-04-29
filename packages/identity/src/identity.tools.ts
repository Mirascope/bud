import { runIdentityCli } from "./identity.cli.ts";
import * as LLM from "@bud/llm";
import { Effect, Schema } from "effect";

export const identityTool = LLM.defineTool({
  name: "identity",
  description:
    "Inspect or update identity context. Use `identity --help` for top-level help, or `identity <command> --help` for command-specific flags.",
  schema: Schema.Struct({
    command: Schema.optionalWith(Schema.String, { default: () => "--help" }),
  }),
  tool: ({ command }) =>
    runIdentityCli(command).pipe(
      Effect.map((output) => LLM.toolResult(output)),
    ),
});
