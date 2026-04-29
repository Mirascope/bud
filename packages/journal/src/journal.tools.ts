import { runJournalCli } from "./journal.cli.ts";
import * as LLM from "@bud/llm";
import { Effect, Schema } from "effect";

export const journalTool = LLM.defineTool({
  name: "journal",
  description:
    "Record or inspect chronological notes. Use `journal --help` for top-level help, or `journal <command> --help` for command-specific flags.",
  schema: Schema.Struct({
    command: Schema.optionalWith(Schema.String, { default: () => "--help" }),
  }),
  tool: ({ command }) =>
    runJournalCli(command).pipe(Effect.map((output) => LLM.toolResult(output))),
});
