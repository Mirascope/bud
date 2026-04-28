import { runCronCli, runIdentityCli, runJournalCli } from "./domain-cli.ts";
import * as LLM from "@bud/llm";
import { Effect, Schema } from "effect";

const commandSchema = Schema.Struct({
  command: Schema.optionalWith(Schema.String, { default: () => "--help" }),
});

export const identityTool = LLM.defineTool({
  name: "identity",
  description:
    "Inspect or update Bud identity context. Commands: `identity show`, `identity set <assistantName|userName|summary> <value>`.",
  schema: commandSchema,
  tool: ({ command }) =>
    runIdentityCli(command).pipe(
      Effect.map((output) => LLM.toolResult(output)),
    ),
});

export const journalTool = LLM.defineTool({
  name: "journal",
  description:
    "Record or inspect chronological notes. Commands: `journal add <text>`, `journal list`, `journal read <id>`, `journal search <query>`.",
  schema: commandSchema,
  tool: ({ command }) =>
    runJournalCli(command).pipe(Effect.map((output) => LLM.toolResult(output))),
});

export const cronTool = LLM.defineTool({
  name: "cron",
  description:
    "Manage scheduled work. Commands: `cron schedule <title> <schedule> <command>`, `cron list`, `cron cancel <id>`, `cron trigger <id>`.",
  schema: commandSchema,
  tool: ({ command }) =>
    runCronCli(command).pipe(Effect.map((output) => LLM.toolResult(output))),
});
