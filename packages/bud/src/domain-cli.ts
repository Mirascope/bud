import { Cron } from "./cron.ts";
import { Identity } from "./identity.ts";
import { Journal } from "./journal.ts";
import { tokenize } from "@bud/computer";
import { Effect } from "effect";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function runIdentityCli(
  command: string,
): Effect.Effect<string, never, Identity> {
  const argv = tokenize(command.trim());
  if (argv[0] === "identity") argv.shift();

  return Effect.gen(function* () {
    const identity = yield* Identity;
    switch (argv[0] ?? "show") {
      case "show":
        return json(yield* identity.get);
      case "set": {
        const key = argv[1] as "assistantName" | "userName" | "summary";
        const value = argv.slice(2).join(" ");
        if (!["assistantName", "userName", "summary"].includes(key)) {
          return json({
            error:
              "Usage: identity set <assistantName|userName|summary> <value>",
          });
        }
        return json(yield* identity.update({ [key]: value }));
      }
      default:
        return json({
          error: "Usage: identity show | identity set <key> <value>",
        });
    }
  }).pipe(Effect.catchAll((error) => Effect.succeed(json({ error }))));
}

export function runJournalCli(
  command: string,
): Effect.Effect<string, never, Journal> {
  const argv = tokenize(command.trim());
  if (argv[0] === "journal") argv.shift();

  return Effect.gen(function* () {
    const journal = yield* Journal;
    switch (argv[0]) {
      case "add":
        return json(yield* journal.add({ text: argv.slice(1).join(" ") }));
      case "list":
        return json(yield* journal.list());
      case "read":
        return json(yield* journal.read(argv[1] ?? ""));
      case "search":
        return json(yield* journal.search(argv.slice(1).join(" ")));
      default:
        return json({
          error:
            "Usage: journal add <text> | journal list | journal read <id> | journal search <query>",
        });
    }
  }).pipe(Effect.catchAll((error) => Effect.succeed(json({ error }))));
}

export function runCronCli(
  command: string,
): Effect.Effect<string, never, Cron> {
  const argv = tokenize(command.trim());
  if (argv[0] === "cron") argv.shift();

  return Effect.gen(function* () {
    const cron = yield* Cron;
    switch (argv[0]) {
      case "schedule": {
        const [title, schedule, ...commandParts] = argv.slice(1);
        if (!title || !schedule || commandParts.length === 0) {
          return json({
            error: "Usage: cron schedule <title> <schedule> <command>",
          });
        }
        return json(
          yield* cron.schedule({
            title,
            schedule,
            command: commandParts.join(" "),
          }),
        );
      }
      case "list":
        return json(yield* cron.list);
      case "cancel":
        return json({ cancelled: yield* cron.cancel(argv[1] ?? "") });
      case "trigger":
        return json(yield* cron.trigger(argv[1] ?? ""));
      default:
        return json({
          error:
            "Usage: cron schedule <title> <schedule> <command> | cron list | cron cancel <id> | cron trigger <id>",
        });
    }
  }).pipe(Effect.catchAll((error) => Effect.succeed(json({ error }))));
}
