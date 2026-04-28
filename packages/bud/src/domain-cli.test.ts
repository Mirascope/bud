import { Cron } from "./cron.ts";
import { runCronCli, runIdentityCli, runJournalCli } from "./domain-cli.ts";
import { Identity } from "./identity.ts";
import { Journal } from "./journal.ts";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

const TestLayer = Layer.mergeAll(
  Identity.memory({ assistantName: "Bud" }),
  Journal.memory({ now: () => "2026-01-01T00:00:00.000Z" }),
  Cron.memory({ now: () => "2026-01-01T00:00:00.000Z" }),
);

const runTest = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer as Layer.Layer<R>));

describe("domain CLIs", () => {
  it("updates identity", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        yield* runIdentityCli("set userName William");
        return yield* runIdentityCli("show");
      }),
    );

    expect(result).toContain('"assistantName": "Bud"');
    expect(result).toContain('"userName": "William"');
  });

  it("records and searches journal entries", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        yield* runJournalCli("add shipped abstractions");
        return yield* runJournalCli("search abstractions");
      }),
    );

    expect(result).toContain("shipped abstractions");
  });

  it("schedules and triggers cron tasks", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const scheduled = yield* runCronCli(
          "schedule standup daily 'journal add checked in'",
        );
        const id = JSON.parse(scheduled).id as string;
        return yield* runCronCli(`trigger ${id}`);
      }),
    );

    const task = JSON.parse(result);
    expect(task.title).toBe("standup");
    expect(task.command).toBe("journal add checked in");
    expect(task.lastTriggeredAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
