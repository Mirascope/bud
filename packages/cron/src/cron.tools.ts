import { runCronCli } from "./cron.cli.ts";
import * as LLM from "@bud/llm";
import { Effect, Schema } from "effect";

export const cronTool = LLM.defineTool({
  name: "cron",
  description:
    "Manage scheduled work. Use `cron --help` for top-level help, or `cron <command> --help` for command-specific flags. Use `cron trigger <id>` for manual execution.",
  schema: Schema.Struct({
    command: Schema.optionalWith(Schema.String, { default: () => "--help" }),
  }),
  tool: ({ command }) =>
    runCronCli(command).pipe(Effect.map((output) => LLM.toolResult(output))),
});
