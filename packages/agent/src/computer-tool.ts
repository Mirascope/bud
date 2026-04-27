import { runComputerCli } from "@bud/computer";
import * as LLM from "@bud/llm";
import { Effect, Schema } from "effect";

export const computerTool = LLM.defineTool({
  name: "computer",
  description: [
    "Run workspace file operations and terminal commands through Bud's computer.",
    "Use `computer --help` for top-level help, or `computer <command> --help` for command-specific flags.",
    "Commands:",
    "- `computer list [--path <path>]` — list workspace files.",
    "- `computer stat <path>` — inspect file or directory metadata.",
    "- `computer read <path> [--offset <line>] [--limit <lines>] [--encoding utf8|base64]` — read file contents.",
    "- `computer write <path> --content <text> [--encoding utf8|base64] [--create-parents]` — write a file.",
    "- `computer edit <path> --old-text <text> --new-text <text> [--replace-all]` — replace text in a file.",
    "- `computer remove <path>` — remove a file or directory.",
    "- `computer bash '<command>' [--cwd <path>] [--shell <shell>]` — run a shell command.",
    "- `computer terminal-start|terminal-write|terminal-read|terminal-kill` — manage interactive terminal sessions.",
  ].join("\n"),
  schema: Schema.Struct({
    command: Schema.optionalWith(
      Schema.String.annotations({
        description:
          "The computer CLI command to run. Use '--help' or '<command> --help' to discover commands and flags.",
      }),
      { default: () => "--help" },
    ),
  }),
  tool: ({ command }) =>
    runComputerCli(command).pipe(
      Effect.map((output) => LLM.toolResult(output)),
    ),
});
