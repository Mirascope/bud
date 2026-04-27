import {
  Computer,
  makeComputerError,
  runComputerCli,
  type ComputerService,
  type DirectoryEntry,
  type FileContent,
  type FileInfo,
  type TerminalSession,
} from "./index.ts";
import { expect, it } from "@bud/testing";
import { Effect, Layer } from "effect";

function decode(content: FileContent): string {
  return content.encoding === "base64" ? atob(content.data) : content.data;
}

function makeInfo(path: string, content: string, updatedAt: string): FileInfo {
  return {
    path,
    kind: "file",
    size: new TextEncoder().encode(content).byteLength,
    updatedAt,
  };
}

function makeFakeComputer(): ComputerService {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  const files = new Map<string, { content: string; updatedAt: string }>();
  const terminals = new Map<
    string,
    { session: TerminalSession; input: string }
  >();

  return {
    list: (path = ".") =>
      Effect.sync(() => {
        const prefix = path === "." ? "" : `${path.replace(/\/$/, "")}/`;
        const entries: DirectoryEntry[] = [];
        for (const [filePath, file] of files) {
          if (!filePath.startsWith(prefix)) continue;
          entries.push({
            path: filePath,
            name: filePath.slice(prefix.length),
            kind: "file",
            size: new TextEncoder().encode(file.content).byteLength,
            updatedAt: file.updatedAt,
          });
        }
        return entries;
      }),

    stat: (path) =>
      Effect.sync(() => {
        const file = files.get(path);
        return file ? makeInfo(path, file.content, file.updatedAt) : null;
      }),

    read: (path, options = {}) =>
      Effect.gen(function* () {
        const file = files.get(path);
        if (!file) {
          return yield* Effect.fail(
            makeComputerError({
              message: "File not found",
              kind: "not_found",
              path,
            }),
          );
        }

        let content = file.content;
        if (options.offset !== undefined || options.limit !== undefined) {
          const offset = Math.max(1, options.offset ?? 1);
          const limit = options.limit ?? Number.POSITIVE_INFINITY;
          content = content
            .split("\n")
            .slice(offset - 1, offset - 1 + limit)
            .join("\n");
        }

        return {
          path,
          content:
            options.encoding === "base64"
              ? { data: btoa(content), encoding: "base64" as const }
              : { data: content, encoding: "utf8" as const },
          size: new TextEncoder().encode(content).byteLength,
          updatedAt: file.updatedAt,
        };
      }),

    write: ({ path, content }) =>
      Effect.sync(() => {
        const decoded = decode(content);
        const updatedAt = now();
        files.set(path, { content: decoded, updatedAt });
        return makeInfo(path, decoded, updatedAt);
      }),

    edit: ({ path, edits }) =>
      Effect.gen(function* () {
        const file = files.get(path);
        if (!file) {
          return yield* Effect.fail(
            makeComputerError({
              message: "File not found",
              kind: "not_found",
              path,
            }),
          );
        }

        let content = file.content;
        let applied = 0;
        for (const edit of edits) {
          const matches = content.split(edit.oldText).length - 1;
          if (matches === 0) {
            return yield* Effect.fail(
              makeComputerError({
                message: "Text not found",
                kind: "conflict",
                path,
              }),
            );
          }
          if (matches > 1 && !edit.replaceAll) {
            return yield* Effect.fail(
              makeComputerError({
                message: "Text matched more than once",
                kind: "conflict",
                path,
              }),
            );
          }
          content = edit.replaceAll
            ? content.split(edit.oldText).join(edit.newText)
            : content.replace(edit.oldText, edit.newText);
          applied += edit.replaceAll ? matches : 1;
        }

        const updatedAt = now();
        files.set(path, { content, updatedAt });
        return {
          path,
          applied,
          content: { data: content, encoding: "utf8" as const },
          size: new TextEncoder().encode(content).byteLength,
          updatedAt,
        };
      }),

    remove: (path) =>
      Effect.sync(() => {
        files.delete(path);
      }),

    startTerminal: (options = {}) =>
      Effect.sync(() => {
        const id = `terminal-${terminals.size + 1}`;
        const session: TerminalSession = {
          id,
          shell: options.shell ?? "bash",
          cwd: options.cwd ?? ".",
          status: "running",
          startedAt: now(),
        };
        terminals.set(id, { session, input: "" });
        return session;
      }),

    writeTerminal: (terminalId, input) =>
      Effect.gen(function* () {
        const terminal = terminals.get(terminalId);
        if (!terminal) {
          return yield* Effect.fail(
            makeComputerError({
              message: "Terminal not found",
              kind: "not_found",
              terminalId,
            }),
          );
        }
        terminal.input += input;
      }),

    readTerminal: (terminalId) =>
      Effect.gen(function* () {
        const terminal = terminals.get(terminalId);
        if (!terminal) {
          return yield* Effect.fail(
            makeComputerError({
              message: "Terminal not found",
              kind: "not_found",
              terminalId,
            }),
          );
        }
        return {
          terminalId,
          output: `ran: ${terminal.input.trim()}`,
          status: terminal.session.status,
          exitCode: 0,
        };
      }),

    killTerminal: (terminalId) =>
      Effect.sync(() => {
        const terminal = terminals.get(terminalId);
        if (!terminal) return;
        terminal.session = {
          ...terminal.session,
          status: "killed",
          exitedAt: now(),
          exitCode: null,
        };
      }),
  };
}

function layer() {
  return Layer.succeed(Computer, makeFakeComputer());
}

it.effect("runs write/read/edit commands in process", () =>
  Effect.gen(function* () {
    const written = yield* runComputerCli(
      "computer write notes.txt --content 'hello world'",
    );
    expect(JSON.parse(written)).toMatchObject({
      path: "notes.txt",
      kind: "file",
    });

    const edited = yield* runComputerCli(
      "computer edit notes.txt --old-text world --new-text bud",
    );
    expect(JSON.parse(edited)).toMatchObject({
      path: "notes.txt",
      applied: 1,
    });

    const read = yield* runComputerCli("computer read notes.txt");
    expect(JSON.parse(read)).toMatchObject({
      path: "notes.txt",
      content: { data: "hello bud", encoding: "utf8" },
    });
  }).pipe(Effect.provide(layer())),
);

it.effect("runs bash through terminal methods", () =>
  Effect.gen(function* () {
    const output = yield* runComputerCli("computer bash 'echo hello'");
    expect(JSON.parse(output)).toMatchObject({
      terminalId: "terminal-1",
      output: "ran: echo hello",
      status: "running",
      exitCode: 0,
    });
  }).pipe(Effect.provide(layer())),
);

it.effect("renders root help with command summaries", () =>
  Effect.gen(function* () {
    const output = yield* runComputerCli("computer --help");

    expect(output).toMatchInlineSnapshot(`
"computer

Workspace file and terminal operations.

Run 'computer <command> --help' for details.

COMMANDS

  list            List files in the workspace.
  stat            Get file or directory metadata.
  read            Read a file from the workspace.
  write           Write a file in the workspace.
  edit            Replace text in a file.
  remove          Remove a file or directory.
  bash            Run a shell command through the terminal.
  terminal-start  Start an interactive terminal session.
  terminal-write  Write input to an interactive terminal.
  terminal-read   Read buffered terminal output.
  terminal-kill   Kill an interactive terminal."
`);
  }).pipe(Effect.provide(layer())),
);

it.effect("renders leaf help for subcommands", () =>
  Effect.gen(function* () {
    const output = yield* runComputerCli("computer read --help");

    expect(output).toMatchInlineSnapshot(`
"computer read

Read a file from the workspace.

USAGE

  computer read <path> [--encoding utf8 | base64] [--offset integer] [--limit integer]

ARGUMENTS

  path

OPTIONS

  --encoding utf8 | base64    File encoding, optional
  --offset integer            1-based line number to start reading from, optional
  --limit integer             Maximum number of lines to read, optional"
`);
  }).pipe(Effect.provide(layer())),
);

it.effect("renders unknown command help with available commands", () =>
  Effect.gen(function* () {
    const output = yield* runComputerCli("computer help missing");

    expect(output).toMatchInlineSnapshot(`
"Unknown command: missing

Available commands: list, stat, read, write, edit, remove, bash, terminal-start, terminal-write, terminal-read, terminal-kill"
`);
  }).pipe(Effect.provide(layer())),
);
