import { Context, type Effect } from "effect";

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

export class Journal extends Context.Tag("@bud/journal/Journal")<
  Journal,
  JournalService
>() {}
