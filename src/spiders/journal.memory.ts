import { Journal, type JournalEntry, type JournalService } from "@bud/journal";
import { Effect, Layer, Ref } from "effect";

export interface JournalMemoryOptions {
  readonly now?: () => string;
}

export function makeJournalMemory(
  options: JournalMemoryOptions = {},
): Effect.Effect<JournalService> {
  return Effect.gen(function* () {
    const now = options.now ?? (() => new Date().toISOString());
    const ref = yield* Ref.make<readonly JournalEntry[]>([]);

    return {
      add: (entry) =>
        Ref.updateAndGet(ref, (entries) => [
          ...entries,
          {
            id: `journal:${crypto.randomUUID()}`,
            text: entry.text,
            tags: entry.tags ? [...entry.tags] : [],
            createdAt: now(),
          },
        ]).pipe(Effect.map((entries) => entries.at(-1)!)),
      list: (options = {}) =>
        Ref.get(ref).pipe(
          Effect.map((entries) => {
            const tagged = options.tag
              ? entries.filter((entry) => entry.tags.includes(options.tag!))
              : entries;
            return tagged.slice(-(options.limit ?? tagged.length)).reverse();
          }),
        ),
      read: (id) =>
        Ref.get(ref).pipe(
          Effect.map(
            (entries) => entries.find((entry) => entry.id === id) ?? null,
          ),
        ),
      search: (query) =>
        Ref.get(ref).pipe(
          Effect.map((entries) => {
            const normalized = query.toLowerCase();
            return entries.filter(
              (entry) =>
                entry.text.toLowerCase().includes(normalized) ||
                entry.tags.some((tag) =>
                  tag.toLowerCase().includes(normalized),
                ),
            );
          }),
        ),
    };
  });
}

export const JournalMemory = (
  options?: JournalMemoryOptions,
): Layer.Layer<Journal> => Layer.effect(Journal, makeJournalMemory(options));
