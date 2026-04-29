import { Journal, type JournalEntry, type JournalService } from "@bud/journal";
import { ObjectStorage, type ObjectStorageService } from "@bud/object-storage";
import { Effect, Layer } from "effect";

export interface JournalLocalStorageOptions {
  readonly namespace?: string;
  readonly now?: () => string;
}

const JSON_CONTENT_TYPE = "application/json";

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function makeJournalLocalStorage(
  objectStorage: ObjectStorageService,
  options: JournalLocalStorageOptions = {},
): JournalService {
  const namespace = options.namespace ?? "bud/journal";
  const now = options.now ?? (() => new Date().toISOString());
  const key = `${namespace}/entries.json`;

  const readEntries = Effect.gen(function* () {
    const head = yield* objectStorage.headObject(key);
    if (!head) return [] as readonly JournalEntry[];
    const object = yield* objectStorage.getObject(key);
    return parseJson<readonly JournalEntry[]>(object.body);
  }).pipe(Effect.orDie);

  const writeEntries = (entries: readonly JournalEntry[]) =>
    objectStorage
      .putObject({
        key,
        body: jsonBytes(entries),
        contentType: JSON_CONTENT_TYPE,
      })
      .pipe(Effect.as(entries), Effect.orDie);

  return {
    add: (entry) =>
      Effect.gen(function* () {
        const entries = yield* readEntries;
        const next = {
          id: `journal:${crypto.randomUUID()}`,
          text: entry.text,
          tags: entry.tags ? [...entry.tags] : [],
          createdAt: now(),
        } satisfies JournalEntry;
        yield* writeEntries([...entries, next]);
        return next;
      }),
    list: (options = {}) =>
      readEntries.pipe(
        Effect.map((entries) => {
          const tagged = options.tag
            ? entries.filter((entry) => entry.tags.includes(options.tag!))
            : entries;
          return tagged.slice(-(options.limit ?? tagged.length)).reverse();
        }),
      ),
    read: (id) =>
      readEntries.pipe(
        Effect.map(
          (entries) => entries.find((entry) => entry.id === id) ?? null,
        ),
      ),
    search: (query) =>
      readEntries.pipe(
        Effect.map((entries) => {
          const normalized = query.toLowerCase();
          return entries.filter(
            (entry) =>
              entry.text.toLowerCase().includes(normalized) ||
              entry.tags.some((tag) => tag.toLowerCase().includes(normalized)),
          );
        }),
      ),
  } satisfies JournalService;
}

export const JournalLocalStorage = (
  options?: JournalLocalStorageOptions,
): Layer.Layer<Journal, never, ObjectStorage> =>
  Layer.effect(
    Journal,
    Effect.map(ObjectStorage, (storage) =>
      makeJournalLocalStorage(storage, options),
    ),
  );
