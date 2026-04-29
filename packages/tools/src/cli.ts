import { CliConfig, Command } from "@effect/cli";
import { FileSystem, Path, Terminal } from "@effect/platform";
import { Cause, Chunk, Effect, Layer, Option, Ref } from "effect";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Command generics are internal to @effect/cli.
type AnyCommand = Command.Command<any, any, any, any>;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (const char of input) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (!quote && (char === '"' || char === "'")) {
      quote = char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function extractMessage(cause: Cause.Cause<unknown>): string {
  const first = Option.getOrUndefined(Chunk.head(Cause.failures(cause)));
  if (first instanceof Error) return first.message;
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "message" in first) {
    const message = (first as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return Cause.pretty(cause);
}

const cliConfig = Layer.succeed(
  CliConfig.CliConfig,
  CliConfig.make({ showBuiltIns: false }),
);

const makeBufferedTerminalLayer = (buffer: Ref.Ref<string[]>) =>
  Layer.succeed(Terminal.Terminal, {
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    isTTY: Effect.succeed(false),
    readInput: Effect.die(new Error("Terminal.readInput unavailable")),
    readLine: Effect.die(new Error("Terminal.readLine unavailable")),
    display: (text: string) =>
      Ref.update(buffer, (lines) => [...lines, text]).pipe(Effect.asVoid),
  } as unknown as Terminal.Terminal);

export function runCliCommand<R>(
  root: AnyCommand,
  name: string,
  command: string,
): Effect.Effect<string, never, R> {
  const cli = Command.run(root, { name, version: "0.0.0" });
  const argv = tokenize(command.trim());
  if (argv[0] === name) argv.shift();

  return Effect.gen(function* () {
    const buffer = yield* Ref.make<string[]>([]);
    const terminalLayer = makeBufferedTerminalLayer(buffer);
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args: unknown[]) => {
      const line = args.map((arg) => String(arg)).join(" ");
      Ref.update(buffer, (lines) => [...lines, line]).pipe(Effect.runSync);
    };
    console.error = (...args: unknown[]) => {
      const line = args.map((arg) => String(arg)).join(" ");
      Ref.update(buffer, (lines) => [...lines, line]).pipe(Effect.runSync);
    };

    try {
      yield* (
        cli(["node", name, ...argv]) as Effect.Effect<void, unknown, R>
      ).pipe(
        Effect.catchAllCause((cause) =>
          Ref.update(buffer, (lines) => [
            ...lines,
            JSON.stringify({ error: extractMessage(cause) }),
          ]),
        ),
        Effect.provide(terminalLayer),
        Effect.provide(Path.layer),
        Effect.provide(FileSystem.layerNoop({})),
        Effect.provide(cliConfig),
      );
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const lines = yield* Ref.get(buffer);
    return lines.join("\n");
  });
}
