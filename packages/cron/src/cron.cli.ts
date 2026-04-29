import { Cron } from "./cron.ts";
import { runCliCommand } from "@bud/tools";
import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

function printJson(value: unknown): Effect.Effect<void> {
  return Console.log(JSON.stringify(value, null, 2));
}

const title = Options.text("title").pipe(
  Options.withDescription("Human-readable scheduled task title."),
);
const schedule = Options.text("schedule").pipe(
  Options.withDescription("Schedule expression or cadence label."),
);
const commandText = Options.text("command").pipe(
  Options.withDescription("Command or prompt to run when triggered."),
);

const scheduleCommand = Command.make(
  "schedule",
  { title, schedule, command: commandText },
  (options) =>
    Effect.gen(function* () {
      const cron = yield* Cron;
      yield* printJson(
        yield* cron.schedule({
          title: options.title,
          schedule: options.schedule,
          command: options.command,
        }),
      );
    }),
).pipe(Command.withDescription("Schedule a cron task."));

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const cron = yield* Cron;
    yield* printJson(yield* cron.list);
  }),
).pipe(Command.withDescription("List cron tasks."));

const idArg = Args.text({ name: "id" });

const cancelCommand = Command.make("cancel", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    const cron = yield* Cron;
    yield* printJson({ cancelled: yield* cron.cancel(id) });
  }),
).pipe(Command.withDescription("Cancel a cron task."));

const triggerCommand = Command.make("trigger", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    const cron = yield* Cron;
    yield* printJson(yield* cron.trigger(id));
  }),
).pipe(Command.withDescription("Manually trigger a cron task."));

export const cronCommand = Command.make("cron", {}, () =>
  Console.log("Use `cron --help` or `cron <command> --help` for help."),
)
  .pipe(
    Command.withSubcommands([
      scheduleCommand,
      listCommand,
      cancelCommand,
      triggerCommand,
    ]),
  )
  .pipe(Command.withDescription("Manage scheduled work."));

export const runCronCli = (command: string) =>
  runCliCommand<Cron>(cronCommand, "cron", command);
