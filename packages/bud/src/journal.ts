import { Context, Effect, Layer, Ref } from "effect";

export interface JournalEntry {
  readonly id: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
}

export interface JournalAppend {
  readonly text: string;
  readonly tags?: readonly string[];
}

export interface JournalService {
  readonly add: (entry: JournalAppend) => Effect.Effect<JournalEntry>;
  readonly list: (options?: {
    readonly limit?: number;
    readonly tag?: string;
  }) => Effect.Effect<readonly JournalEntry[]>;
  readonly read: (id: string) => Effect.Effect<JournalEntry | null>;
  readonly search: (query: string) => Effect.Effect<readonly JournalEntry[]>;
}

export class Journal extends Context.Tag("@bud/bud/Journal")<
  Journal,
  JournalService
>() {
  static memory(
    options: { readonly now?: () => string } = {},
  ): Layer.Layer<Journal> {
    return Layer.effect(
      Journal,
      Effect.gen(function* () {
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
                return tagged
                  .slice(-(options.limit ?? tagged.length))
                  .reverse();
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
      }),
    );
  }
}
