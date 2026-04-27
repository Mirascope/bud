import {
  Computer,
  type FileEncoding,
  type TerminalStartOptions,
} from "./computer.ts";
import { Args, Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

function printJson(value: unknown): Effect.Effect<void> {
  return Console.log(JSON.stringify(value, null, 2));
}

const pathArg = Args.text({ name: "path" });
const encoding = Options.choice("encoding", ["utf8", "base64"] as const).pipe(
  Options.withDescription("File encoding"),
  Options.withDefault("utf8" satisfies FileEncoding),
);

const listPath = Options.text("path").pipe(
  Options.withDescription("Directory path to list"),
  Options.optional,
);

const listCommand = Command.make("list", { path: listPath }, ({ path }) =>
  Effect.gen(function* () {
    const computer = yield* Computer;
    const entries = yield* computer.list(Option.getOrUndefined(path));
    yield* printJson(entries);
  }),
).pipe(Command.withDescription("List files in the workspace."));

const statCommand = Command.make("stat", { path: pathArg }, ({ path }) =>
  Effect.gen(function* () {
    const computer = yield* Computer;
    const info = yield* computer.stat(path);
    yield* printJson(info);
  }),
).pipe(Command.withDescription("Get file or directory metadata."));

const offset = Options.integer("offset").pipe(
  Options.withDescription("1-based line number to start reading from"),
  Options.optional,
);
const limit = Options.integer("limit").pipe(
  Options.withDescription("Maximum number of lines to read"),
  Options.optional,
);

const readCommand = Command.make(
  "read",
  { path: pathArg, encoding, offset, limit },
  ({ path, encoding, offset, limit }) =>
    Effect.gen(function* () {
      const computer = yield* Computer;
      const response = yield* computer.read(path, {
        encoding,
        offset: Option.getOrUndefined(offset),
        limit: Option.getOrUndefined(limit),
      });
      yield* printJson(response);
    }),
).pipe(Command.withDescription("Read a file from the workspace."));

const content = Options.text("content").pipe(
  Options.withDescription("File contents to write"),
);
const createParents = Options.boolean("create-parents").pipe(
  Options.withDescription("Create missing parent directories"),
  Options.withDefault(false),
);

const writeCommand = Command.make(
  "write",
  { path: pathArg, content, encoding, createParents },
  ({ path, content, encoding, createParents }) =>
    Effect.gen(function* () {
      const computer = yield* Computer;
      const info = yield* computer.write({
        path,
        content: { data: content, encoding },
        createParents,
      });
      yield* printJson(info);
    }),
).pipe(Command.withDescription("Write a file in the workspace."));

const oldText = Options.text("old-text").pipe(
  Options.withDescription("Exact text to replace"),
);
const newText = Options.text("new-text").pipe(
  Options.withDescription("Replacement text"),
);
const replaceAll = Options.boolean("replace-all").pipe(
  Options.withDescription("Replace every occurrence"),
  Options.withDefault(false),
);

const editCommand = Command.make(
  "edit",
  { path: pathArg, oldText, newText, replaceAll },
  ({ path, oldText, newText, replaceAll }) =>
    Effect.gen(function* () {
      const computer = yield* Computer;
      const response = yield* computer.edit({
        path,
        edits: [{ oldText, newText, replaceAll }],
      });
      yield* printJson(response);
    }),
).pipe(Command.withDescription("Replace text in a file."));

const removeCommand = Command.make("remove", { path: pathArg }, ({ path }) =>
  Effect.gen(function* () {
    const computer = yield* Computer;
    yield* computer.remove(path);
    yield* printJson({ success: true, path });
  }),
).pipe(Command.withDescription("Remove a file or directory."));

const bashCommandText = Args.text({ name: "command" });
const cwd = Options.text("cwd").pipe(
  Options.withDescription("Working directory"),
  Options.optional,
);
const shell = Options.text("shell").pipe(
  Options.withDescription("Shell to start"),
  Options.optional,
);

const bashCommand = Command.make(
  "bash",
  { command: bashCommandText, cwd, shell },
  ({ command, cwd, shell }) =>
    Effect.gen(function* () {
      const computer = yield* Computer;
      const options: TerminalStartOptions = {
        cwd: Option.getOrUndefined(cwd),
        shell: Option.getOrUndefined(shell),
      };
      const terminal = yield* computer.startTerminal(options);
      yield* computer.writeTerminal(terminal.id, `${command}\n`);
      const output = yield* computer.readTerminal(terminal.id);
      yield* printJson(output);
    }),
).pipe(Command.withDescription("Run a shell command through the terminal."));

const terminalStartCommand = Command.make(
  "terminal-start",
  { cwd, shell },
  ({ cwd, shell }) =>
    Effect.gen(function* () {
      const computer = yield* Computer;
      const terminal = yield* computer.startTerminal({
        cwd: Option.getOrUndefined(cwd),
        shell: Option.getOrUndefined(shell),
      });
      yield* printJson(terminal);
    }),
).pipe(Command.withDescription("Start an interactive terminal session."));

const terminalId = Args.text({ name: "terminal-id" });
const terminalInput = Args.text({ name: "input" });

const terminalWriteCommand = Command.make(
  "terminal-write",
  { terminalId, input: terminalInput },
  ({ terminalId, input }) =>
    Effect.gen(function* () {
      const computer = yield* Computer;
      yield* computer.writeTerminal(terminalId, input);
      yield* printJson({ success: true, terminalId });
    }),
).pipe(Command.withDescription("Write input to an interactive terminal."));

const terminalReadCommand = Command.make(
  "terminal-read",
  { terminalId },
  ({ terminalId }) =>
    Effect.gen(function* () {
      const computer = yield* Computer;
      const output = yield* computer.readTerminal(terminalId);
      yield* printJson(output);
    }),
).pipe(Command.withDescription("Read buffered terminal output."));

const terminalKillCommand = Command.make(
  "terminal-kill",
  { terminalId },
  ({ terminalId }) =>
    Effect.gen(function* () {
      const computer = yield* Computer;
      yield* computer.killTerminal(terminalId);
      yield* printJson({ success: true, terminalId });
    }),
).pipe(Command.withDescription("Kill an interactive terminal."));

const helpText = [
  "computer",
  "",
  "COMMANDS",
  "",
  "  list             List files in the workspace",
  "  stat             Get file or directory metadata",
  "  read             Read a file",
  "  write            Write a file",
  "  edit             Replace text in a file",
  "  remove           Remove a file or directory",
  "  bash             Run a shell command through the terminal",
  "  terminal-start   Start an interactive terminal",
  "  terminal-write   Write input to a terminal",
  "  terminal-read    Read terminal output",
  "  terminal-kill    Kill a terminal",
].join("\n");

export const computerCommand = Command.make("computer", {}, () =>
  Console.log(helpText),
).pipe(
  Command.withDescription("Workspace file and terminal operations."),
  Command.withSubcommands([
    listCommand,
    statCommand,
    readCommand,
    writeCommand,
    editCommand,
    removeCommand,
    bashCommand,
    terminalStartCommand,
    terminalWriteCommand,
    terminalReadCommand,
    terminalKillCommand,
  ]),
);
