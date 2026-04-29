import { Journal } from "./journal.ts";
import { runCliCommand } from "@bud/tools";
import { Args, Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

function printJson(value: unknown): Effect.Effect<void> {
  return Console.log(JSON.stringify(value, null, 2));
}

const textArg = Args.text({ name: "text" }).pipe(
  Args.withDescription("Journal text. Quote values that contain spaces."),
);

const addCommand = Command.make("add", { text: textArg }, ({ text }) =>
  Effect.gen(function* () {
    const journal = yield* Journal;
    yield* printJson(yield* journal.add({ text }));
  }),
).pipe(Command.withDescription("Append a journal entry."));

const limitOption = Options.integer("limit").pipe(
  Options.withDescription("Maximum entries to return."),
  Options.optional,
);
const tagOption = Options.text("tag").pipe(
  Options.withDescription("Filter entries by tag."),
  Options.optional,
);

const listCommand = Command.make(
  "list",
  { limit: limitOption, tag: tagOption },
  ({ limit, tag }) =>
    Effect.gen(function* () {
      const journal = yield* Journal;
      yield* printJson(
        yield* journal.list({
          limit: Option.getOrUndefined(limit),
          tag: Option.getOrUndefined(tag),
        }),
      );
    }),
).pipe(Command.withDescription("List recent journal entries."));

const idArg = Args.text({ name: "id" });

const readCommand = Command.make("read", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    const journal = yield* Journal;
    yield* printJson(yield* journal.read(id));
  }),
).pipe(Command.withDescription("Read a journal entry."));

const queryArg = Args.text({ name: "query" }).pipe(
  Args.withDescription("Search query. Quote values that contain spaces."),
);

const searchCommand = Command.make("search", { query: queryArg }, ({ query }) =>
  Effect.gen(function* () {
    const journal = yield* Journal;
    yield* printJson(yield* journal.search(query));
  }),
).pipe(Command.withDescription("Search journal entries."));

export const journalCommand = Command.make("journal", {}, () =>
  Console.log("Use `journal --help` or `journal <command> --help` for help."),
)
  .pipe(
    Command.withSubcommands([
      addCommand,
      listCommand,
      readCommand,
      searchCommand,
    ]),
  )
  .pipe(Command.withDescription("Record or inspect chronological notes."));

export const runJournalCli = (command: string) =>
  runCliCommand<Journal>(journalCommand, "journal", command);
