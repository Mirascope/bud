import { Identity } from "./identity.ts";
import { runCliCommand } from "@bud/tools";
import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

function printJson(value: unknown): Effect.Effect<void> {
  return Console.log(JSON.stringify(value, null, 2));
}

const showCommand = Command.make("show", {}, () =>
  Effect.gen(function* () {
    const identity = yield* Identity;
    yield* printJson(yield* identity.get);
  }),
).pipe(Command.withDescription("Show the identity profile."));

const identityField = Args.choice([
  ["assistantName", "assistantName"],
  ["userName", "userName"],
  ["summary", "summary"],
] as const).pipe(Args.withDescription("Identity field to update."));
const identityValue = Args.text({ name: "value" }).pipe(
  Args.withDescription("New value. Quote values that contain spaces."),
);

const setCommand = Command.make(
  "set",
  { field: identityField, value: identityValue },
  ({ field, value }) =>
    Effect.gen(function* () {
      const identity = yield* Identity;
      yield* printJson(yield* identity.update({ [field]: value }));
    }),
).pipe(Command.withDescription("Update an identity field."));

export const identityCommand = Command.make("identity", {}, () =>
  showCommand.handler({}),
)
  .pipe(Command.withSubcommands([showCommand, setCommand]))
  .pipe(Command.withDescription("Inspect or update identity context."));

export const runIdentityCli = (command: string) =>
  runCliCommand<Identity>(identityCommand, "identity", command);
