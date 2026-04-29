import { CronLocalStorage } from "../spiders/cron.local-storage.ts";
import { IdentityLocalStorage } from "../spiders/identity.local-storage.ts";
import { JournalLocalStorage } from "../spiders/journal.local-storage.ts";
import { runCronCli } from "@bud/cron";
import { runIdentityCli } from "@bud/identity";
import { runJournalCli } from "@bud/journal";
import { InMemory } from "@bud/object-storage";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

const TestLayer = Layer.mergeAll(
  IdentityLocalStorage({ initial: { assistantName: "Bud" } }).pipe(
    Layer.provide(InMemory.layer()),
  ),
  JournalLocalStorage({ now: () => "2026-01-01T00:00:00.000Z" }).pipe(
    Layer.provide(InMemory.layer()),
  ),
  CronLocalStorage({ now: () => "2026-01-01T00:00:00.000Z" }).pipe(
    Layer.provide(InMemory.layer()),
  ),
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
        yield* runJournalCli("add 'shipped abstractions'");
        return yield* runJournalCli("search abstractions");
      }),
    );

    expect(result).toContain("shipped abstractions");
  });

  it("schedules and triggers cron tasks", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const scheduled = yield* runCronCli(
          "schedule --title standup --schedule daily --command 'journal add checked in'",
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
