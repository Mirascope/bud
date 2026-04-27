import { formatCompactSummary, getCompactPrompt } from "./compact-prompt.ts";
import { messagesFromSegmentEntries } from "./entries-to-messages.ts";
import { groupExchanges } from "./exchange.ts";
import {
  hashPromptSnapshot,
  normalize as normalizePromptSnapshot,
} from "./prompt-snapshot.ts";
import type {
  ScanSegmentOptions,
  ScanSegmentResult,
  SegmentInfo,
  SegmentsService,
} from "./segments.schemas.ts";
import {
  type AssistantTurn,
  type CompactionTurn,
  Sessions,
  type ModelUpdate,
  type PromptSnapshot,
  type Scope,
  SessionError,
  type SessionHeader,
  type SessionId,
  type SessionEntry,
  type SessionSummary,
  type SessionsService,
  type SystemPromptChange,
  type ThinkingLevel,
  type Turn,
  type UserTurn,
  scopeFromSessionId,
} from "./sessions.schemas.ts";
import { WebCrypto, type CryptoService } from "@bud/crypto";
import * as LLM from "@bud/llm";
import {
  base64ToBytes,
  bytesToBase64,
  ObjectStorage,
  type ObjectStorageService,
} from "@bud/object-storage";
import { Effect, Layer } from "effect";

export interface SessionsLocalStorageOptions {
  readonly namespace?: string;
  readonly now?: () => string;
  readonly crypto?: CryptoService;
}

interface StoredSegment {
  entries: SessionEntry[];
}

interface StoredSession {
  readonly sessionId: SessionId;
  readonly segments: StoredSegment[];
}

const DEFAULT_NAMESPACE = "bud/sessions";
const JSON_CONTENT_TYPE = "application/json";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function sessionFailure(
  message: string,
  sessionId?: string,
  cause?: unknown,
): SessionError {
  return new SessionError({ message, sessionId, cause });
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function responseData(response: LLM.Response): LLM.ResponseData {
  return new LLM.ResponseData({
    content: [...response.content],
    usage: response.usage,
    finishReason: response.finishReason,
    providerId: response.providerId,
    modelId: response.modelId,
    providerModelName: response.providerModelName,
    rawMessage: response.rawMessage,
  });
}

function entryTimestamp(entry: SessionEntry): string {
  return "timestamp" in entry ? entry.timestamp : "";
}

function entryCostCenticents(entry: SessionEntry): number {
  if (entry.type === "assistant_turn") {
    return entry.response.usage.costCenticents;
  }
  if (entry.type === "compaction") {
    return entry.usage.costCenticents;
  }
  return 0;
}

function segmentHeader(segment: StoredSegment): SessionHeader {
  const header = segment.entries[0];
  if (header?.type !== "session_header") {
    throw new Error("Stored segment is missing a session header");
  }
  return header;
}

function latestTimestamp(entries: readonly SessionEntry[]): string | null {
  let latest: string | null = null;
  for (const entry of entries) {
    const timestamp = entryTimestamp(entry);
    if (timestamp && (!latest || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

function currentModelIdForEntries(entries: readonly SessionEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "model_update") return entry.modelId;
  }
  return segmentHeader({ entries: [...entries] }).modelId;
}

function currentThinkingLevelForEntries(
  entries: readonly SessionEntry[],
): ThinkingLevel | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "model_update") {
      return entry.thinkingLevel ?? null;
    }
  }
  return null;
}

function activeSegment(session: StoredSession): StoredSegment {
  const segment = session.segments.at(-1);
  if (!segment) throw new Error("Stored session has no segments");
  return segment;
}

function activeHeader(session: StoredSession): SessionHeader {
  return segmentHeader(activeSegment(session));
}

function turnCount(entries: readonly SessionEntry[]): number {
  return entries.filter(
    (entry) =>
      entry.type === "user_turn" ||
      entry.type === "assistant_turn" ||
      entry.type === "compaction",
  ).length;
}

function messagesFromEntries(
  entries: readonly SessionEntry[],
  systemPrompt?: string,
): LLM.Message[] {
  const sessionMessages = messagesFromSegmentEntries(
    entries.filter((entry) => entry.type !== "session_header"),
  );
  return systemPrompt
    ? [LLM.system(systemPrompt), ...sessionMessages]
    : sessionMessages;
}

export function makeSessionsLocalStorage(
  objectStorage: ObjectStorageService,
  options: SessionsLocalStorageOptions = {},
): SessionsService {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const now = options.now ?? (() => new Date().toISOString());
  const crypto = options.crypto ?? WebCrypto.make();

  const sessionsKey = `${namespace}/sessions/index.json`;
  const sessionKey = (sessionId: string) =>
    `${namespace}/sessions/${encodeURIComponent(sessionId)}.json`;
  const promptKey = (hash: string) => `${namespace}/prompts/${hash}.json`;
  const mediaKey = (sessionId: SessionId) =>
    `${namespace}/media/${encodeURIComponent(sessionId)}/${crypto.randomUUID()}`;

  function readJson<T>(key: string): Effect.Effect<T | null, SessionError> {
    return Effect.gen(function* () {
      const head = yield* objectStorage
        .headObject(key)
        .pipe(
          Effect.mapError((cause) =>
            sessionFailure("Unable to inspect stored object", undefined, cause),
          ),
        );
      if (!head) return null;

      const object = yield* objectStorage
        .getObject(key)
        .pipe(
          Effect.mapError((cause) =>
            sessionFailure("Unable to read stored object", undefined, cause),
          ),
        );
      return parseJson<T>(object.body);
    });
  }

  function writeJson(
    key: string,
    value: unknown,
  ): Effect.Effect<void, SessionError> {
    return Effect.gen(function* () {
      const body = yield* Effect.try({
        try: () => jsonBytes(value),
        catch: (cause) =>
          sessionFailure("Unable to serialize stored object", undefined, cause),
      });
      yield* objectStorage.putObject({
        key,
        body,
        contentType: JSON_CONTENT_TYPE,
      });
    }).pipe(
      Effect.asVoid,
      Effect.mapError((cause) =>
        sessionFailure("Unable to write stored object", undefined, cause),
      ),
    );
  }

  const readIndex = (): Effect.Effect<SessionId[], SessionError> =>
    readJson<SessionId[]>(sessionsKey).pipe(
      Effect.map((sessionIds) => sessionIds ?? []),
    );

  const writeIndex = (
    sessionIds: readonly SessionId[],
  ): Effect.Effect<void, SessionError> =>
    writeJson(sessionsKey, [...new Set(sessionIds)]);

  function readSession(
    sessionId: SessionId,
  ): Effect.Effect<StoredSession, SessionError> {
    return Effect.gen(function* () {
      const session = yield* readJson<StoredSession>(sessionKey(sessionId));
      if (!session) {
        return yield* Effect.fail(
          sessionFailure("Session not found", sessionId),
        );
      }
      return session;
    });
  }

  function writeSession(
    session: StoredSession,
  ): Effect.Effect<void, SessionError> {
    return Effect.gen(function* () {
      yield* writeJson(sessionKey(session.sessionId), session);
      const index = yield* readIndex();
      yield* writeIndex([...index, session.sessionId]);
    });
  }

  function mutateSession(
    sessionId: SessionId,
    f: (session: StoredSession) => void,
  ): Effect.Effect<void, SessionError> {
    return Effect.gen(function* () {
      const session = yield* readSession(sessionId);
      f(session);
      yield* writeSession(session);
    });
  }

  function storeBytes(
    sessionId: SessionId,
    bytes: Uint8Array,
    contentType: string,
  ): Effect.Effect<string, SessionError> {
    return objectStorage
      .putObject({
        key: mediaKey(sessionId),
        body: bytes,
        contentType,
        metadata: { sessionId },
      })
      .pipe(
        Effect.map((object) => object.key),
        Effect.mapError((cause) =>
          sessionFailure("Unable to store media object", sessionId, cause),
        ),
      );
  }

  function normalizePart(
    sessionId: SessionId,
    part: LLM.UserContentPart,
  ): Effect.Effect<LLM.UserContentPart, SessionError> {
    switch (part.type) {
      case "image":
        if (part.source.type !== "base64_image_source")
          return Effect.succeed(part);
        {
          const source = part.source;
          return storeBytes(
            sessionId,
            base64ToBytes(source.data),
            source.mimeType,
          ).pipe(
            Effect.map(
              (key): LLM.UserContentPart => ({
                type: "image",
                source: {
                  type: "object_storage_image_source",
                  key,
                  mimeType: source.mimeType,
                },
              }),
            ),
          );
        }

      case "document":
        if (part.source.type !== "base64_document_source") {
          return Effect.succeed(part);
        }
        {
          const source = part.source;
          return storeBytes(
            sessionId,
            base64ToBytes(source.data),
            source.mediaType,
          ).pipe(
            Effect.map(
              (key): LLM.UserContentPart => ({
                type: "document",
                source: {
                  type: "object_storage_document_source",
                  key,
                  mediaType: source.mediaType,
                },
              }),
            ),
          );
        }

      case "audio":
        if (part.source.type !== "base64_audio_source")
          return Effect.succeed(part);
        return storeBytes(
          sessionId,
          base64ToBytes(part.source.data),
          part.source.mimeType,
        ).pipe(
          Effect.map(
            (key): LLM.UserContentPart => ({
              type: "audio",
              source: {
                type: "object_storage_audio_source",
                key,
                mimeType: part.source.mimeType,
              },
            }),
          ),
        );

      default:
        return Effect.succeed(part);
    }
  }

  function normalizeUserMessage(
    sessionId: SessionId,
    message: LLM.UserMessage,
  ): Effect.Effect<LLM.UserMessage, SessionError> {
    return Effect.gen(function* () {
      const content: LLM.UserContentPart[] = [];
      for (const part of message.content) {
        content.push(yield* normalizePart(sessionId, part));
      }
      return { ...message, content };
    });
  }

  function hydratePart(
    part: LLM.UserContentPart,
  ): Effect.Effect<LLM.UserContentPart, SessionError> {
    switch (part.type) {
      case "image":
        if (part.source.type !== "object_storage_image_source") {
          return Effect.succeed(part);
        }
        {
          const source = part.source;
          return objectStorage.getObject(source.key).pipe(
            Effect.map(
              (object): LLM.UserContentPart => ({
                type: "image",
                source: {
                  type: "base64_image_source",
                  data: bytesToBase64(object.body),
                  mimeType: source.mimeType,
                },
              }),
            ),
            Effect.mapError((cause) =>
              sessionFailure("Unable to hydrate image", undefined, cause),
            ),
          );
        }

      case "document":
        if (part.source.type !== "object_storage_document_source") {
          return Effect.succeed(part);
        }
        {
          const source = part.source;
          return objectStorage.getObject(source.key).pipe(
            Effect.map(
              (object): LLM.UserContentPart => ({
                type: "document",
                source: {
                  type: "base64_document_source",
                  data: bytesToBase64(object.body),
                  mediaType: source.mediaType,
                },
              }),
            ),
            Effect.mapError((cause) =>
              sessionFailure("Unable to hydrate document", undefined, cause),
            ),
          );
        }

      case "audio":
        if (part.source.type !== "object_storage_audio_source") {
          return Effect.succeed(part);
        }
        return objectStorage.getObject(part.source.key).pipe(
          Effect.map(
            (object): LLM.UserContentPart => ({
              type: "audio",
              source: {
                type: "base64_audio_source",
                data: bytesToBase64(object.body),
                mimeType: part.source.mimeType,
              },
            }),
          ),
          Effect.mapError((cause) =>
            sessionFailure("Unable to hydrate audio", undefined, cause),
          ),
        );

      default:
        return Effect.succeed(part);
    }
  }

  function hydrateMessage(
    message: LLM.Message,
  ): Effect.Effect<LLM.Message, SessionError> {
    if (message.role !== "user") return Effect.succeed(message);
    return Effect.gen(function* () {
      const content: LLM.UserContentPart[] = [];
      for (const part of message.content) {
        content.push(yield* hydratePart(part));
      }
      return { ...message, content };
    });
  }

  function hydrateMessages(
    messages: readonly LLM.Message[],
  ): Effect.Effect<LLM.Message[], SessionError> {
    return Effect.gen(function* () {
      const hydrated: LLM.Message[] = [];
      for (const message of messages) {
        hydrated.push(yield* hydrateMessage(message));
      }
      return hydrated;
    });
  }

  const segments: SegmentsService = {
    list: (sessionId) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        return session.segments.map((segment, index): SegmentInfo => {
          const header = segmentHeader(segment);
          return {
            index,
            segmentRef: `${sessionId}:${index}`,
            sizeBytes: jsonBytes(segment.entries).byteLength,
            modelId: currentModelIdForEntries(segment.entries),
            timestamp: header.timestamp,
            turnCount: turnCount(segment.entries),
            hasCompaction: segment.entries.some(
              (entry) => entry.type === "compaction",
            ),
            pastMessageCount: header.pastMessageCount ?? 0,
          };
        });
      }),

    read: (sessionId, segmentIndex) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        const segment = session.segments[segmentIndex];
        if (!segment) {
          return yield* Effect.fail(
            sessionFailure("Segment not found", sessionId),
          );
        }
        return [...segment.entries];
      }),

    readActive: (sessionId) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        return [...activeSegment(session).entries];
      }),

    scan: (sessionId, options: ScanSegmentOptions) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        const segmentIndex =
          options.segmentIndex ?? Math.max(session.segments.length - 1, 0);
        const segment = session.segments[segmentIndex];
        if (!segment) {
          return yield* Effect.fail(
            sessionFailure("Segment not found", sessionId),
          );
        }

        let entries = segment.entries.filter((entry) => {
          const timestamp = entryTimestamp(entry);
          if (options.since && timestamp && timestamp < options.since) {
            return false;
          }
          if (options.until && timestamp && timestamp > options.until) {
            return false;
          }
          return true;
        });

        if (options.order === "desc") entries = [...entries].reverse();
        if (options.limit !== undefined)
          entries = entries.slice(0, options.limit);

        return {
          entries,
          segmentCount: session.segments.length,
          segmentIndex,
        } satisfies ScanSegmentResult;
      }),
  };

  return {
    list: (scope?: Scope) =>
      Effect.gen(function* () {
        const index = yield* readIndex();
        const headers: { header: SessionHeader; lastActiveAt: string }[] = [];

        for (const sessionId of index) {
          const session = yield* readSession(sessionId);
          const header = activeHeader(session);
          if (scope && scopeFromSessionId(header.sessionId) !== scope) continue;
          headers.push({
            header,
            lastActiveAt:
              latestTimestamp(activeSegment(session).entries) ??
              activeHeader(session).timestamp,
          });
        }

        return headers
          .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
          .map(({ header }) => header);
      }),

    summarize: (scope?: Scope, windows = {}) =>
      Effect.gen(function* () {
        const index = yield* readIndex();
        const summaries: SessionSummary[] = [];

        for (const sessionId of index) {
          const session = yield* readSession(sessionId);
          if (scope && scopeFromSessionId(session.sessionId) !== scope)
            continue;

          const entries = session.segments.flatMap(
            (segment) => segment.entries,
          );
          const cost = (since?: string) =>
            entries
              .filter((entry) => !since || entryTimestamp(entry) >= since)
              .reduce((sum, entry) => sum + entryCostCenticents(entry), 0);

          summaries.push({
            sessionId: session.sessionId,
            scope: scopeFromSessionId(session.sessionId),
            lastActiveAt:
              latestTimestamp(entries) ?? activeHeader(session).timestamp,
            costCenticents: {
              lifetime: cost(),
              weekly: windows.weeklyWindowStart
                ? cost(windows.weeklyWindowStart)
                : undefined,
              burst: windows.burstWindowStart
                ? cost(windows.burstWindowStart)
                : undefined,
            },
          });
        }

        return summaries;
      }),

    open: (sessionId) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        return activeHeader(session);
      }),

    create: (options) =>
      Effect.gen(function* () {
        const existing = yield* readJson<StoredSession>(
          sessionKey(options.sessionId),
        );
        if (existing) return activeHeader(existing);

        const timestamp = now();
        const header: SessionHeader = {
          type: "session_header",
          sessionId: options.sessionId,
          modelId: options.modelId,
          timestamp,
          segmentIndex: 0,
          pastMessageCount: 0,
          systemPromptHash: options.systemPromptHash,
        };

        const session: StoredSession = {
          sessionId: options.sessionId,
          segments: [{ entries: [header] }],
        };

        if (options.forkFromSessionId) {
          const forkSource = yield* readSession(options.forkFromSessionId);
          const forkHeader = activeHeader(forkSource);
          const sourceEntries = activeSegment(forkSource).entries.filter(
            (entry) => entry.type !== "session_header",
          );
          session.segments[0] = {
            entries: [
              {
                ...header,
                systemPromptHash:
                  options.systemPromptHash ?? forkHeader.systemPromptHash,
              },
              ...sourceEntries,
            ],
          };
        }

        yield* writeSession(session);
        return activeHeader(session);
      }),

    recordSystemPrompt: (sessionId, hash) =>
      mutateSession(sessionId, (session) => {
        const segment = activeSegment(session);
        const previous = [...segment.entries]
          .reverse()
          .find((entry) => entry.type === "system_prompt_change");
        if (
          previous?.type === "system_prompt_change" &&
          previous.hash === hash
        ) {
          return;
        }
        const entry: SystemPromptChange = {
          type: "system_prompt_change",
          hash,
          timestamp: now(),
        };
        const header = segmentHeader(segment);
        segment.entries[0] = { ...header, systemPromptHash: hash };
        segment.entries.push(entry);
      }),

    writePromptSnapshot: (systemPrompt, tools) =>
      Effect.gen(function* () {
        const snapshot = normalizePromptSnapshot(systemPrompt, tools);
        const hash = yield* hashPromptSnapshot(snapshot, crypto);
        yield* writeJson(promptKey(hash), snapshot);
        return { hash, snapshot };
      }),

    getPromptSnapshot: (hash) =>
      Effect.gen(function* () {
        if (!HASH_PATTERN.test(hash)) return null;
        const snapshot = yield* readJson<PromptSnapshot>(promptKey(hash));
        return snapshot ? { hash, ...snapshot } : null;
      }),

    addUserTurn: (sessionId, message) =>
      Effect.gen(function* () {
        const normalized = yield* normalizeUserMessage(sessionId, message);
        yield* mutateSession(sessionId, (session) => {
          const entry: UserTurn = {
            type: "user_turn",
            message: normalized,
            timestamp: now(),
          };
          activeSegment(session).entries.push(entry);
        });
      }),

    addAssistantTurn: (sessionId, response) =>
      mutateSession(sessionId, (session) => {
        const entry: AssistantTurn = {
          type: "assistant_turn",
          response: responseData(response),
          timestamp: now(),
        };
        activeSegment(session).entries.push(entry);
      }),

    turns: (sessionId) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        return activeSegment(session).entries.filter(
          (entry): entry is Turn =>
            entry.type === "user_turn" ||
            entry.type === "assistant_turn" ||
            entry.type === "compaction",
        );
      }),

    messages: (sessionId, options) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        return yield* hydrateMessages(
          messagesFromEntries(
            activeSegment(session).entries,
            options?.systemPrompt,
          ),
        );
      }),

    compact: (sessionId, options) =>
      Effect.gen(function* () {
        const model = yield* LLM.Model;
        const session = yield* readSession(sessionId);
        const segment = activeSegment(session);
        const header = segmentHeader(segment);
        const existingMessages = yield* hydrateMessages(
          messagesFromEntries(segment.entries),
        );
        const trailingEntry = segment.entries.at(-1);
        const trailingUserTurn =
          trailingEntry?.type === "user_turn" ? trailingEntry : undefined;

        const response = yield* model
          .call({
            content: [
              LLM.system(
                options.systemInstructions ??
                  getCompactPrompt(options.instructions),
              ),
              ...existingMessages,
              LLM.user("Create the compaction summary now."),
            ],
          })
          .pipe(
            Effect.mapError((cause) =>
              sessionFailure("Unable to compact session", sessionId, cause),
            ),
          );

        const nextHeader: SessionHeader = {
          type: "session_header",
          sessionId,
          modelId: currentModelIdForEntries(segment.entries),
          timestamp: now(),
          segmentIndex: session.segments.length,
          pastMessageCount: existingMessages.filter(
            (message) => message.role !== "system",
          ).length,
          systemPromptHash: header.systemPromptHash,
        };
        const compaction: CompactionTurn = {
          type: "compaction",
          summary: formatCompactSummary(response.text),
          usage: response.usage,
          timestamp: now(),
        };

        session.segments.push({
          entries: [
            nextHeader,
            compaction,
            ...(trailingUserTurn ? [trailingUserTurn] : []),
          ],
        });
        yield* writeSession(session);

        return yield* hydrateMessages(
          messagesFromEntries(
            activeSegment(session).entries,
            options.systemPrompt,
          ),
        );
      }),

    updateModel: (sessionId, modelId, thinkingLevel) =>
      mutateSession(sessionId, (session) => {
        const entry: ModelUpdate = {
          type: "model_update",
          modelId,
          thinkingLevel,
          timestamp: now(),
        };
        activeSegment(session).entries.push(entry);
      }),

    currentModelId: (sessionId) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        return currentModelIdForEntries(activeSegment(session).entries);
      }),

    currentThinkingLevel: (sessionId) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        return currentThinkingLevelForEntries(activeSegment(session).entries);
      }),

    clear: (sessionId) =>
      mutateSession(sessionId, (session) => {
        const segment = activeSegment(session);
        const header = segmentHeader(segment);
        const nextHeader: SessionHeader = {
          type: "session_header",
          sessionId,
          modelId: currentModelIdForEntries(segment.entries),
          timestamp: now(),
          segmentIndex: session.segments.length,
          pastMessageCount: 0,
          systemPromptHash: header.systemPromptHash,
        };
        session.segments.push({ entries: [nextHeader] });
      }),

    dropLastExchange: (sessionId) =>
      Effect.gen(function* () {
        let droppedCount = 0;
        yield* mutateSession(sessionId, (session) => {
          const segment = activeSegment(session);
          const header = segmentHeader(segment);
          const grouped = groupExchanges(segment.entries.slice(1));
          const exchangeIndex = grouped.findLastIndex(Array.isArray);
          if (exchangeIndex < 0) return;

          const dropped = grouped[exchangeIndex];
          if (!Array.isArray(dropped)) return;

          grouped.splice(exchangeIndex, 1);
          droppedCount = dropped.length;
          segment.entries = [
            header,
            ...grouped.flatMap((item) => (Array.isArray(item) ? item : [item])),
          ];
        });
        return droppedCount;
      }),

    delete: (sessionId) =>
      Effect.gen(function* () {
        yield* objectStorage
          .deleteObject(sessionKey(sessionId))
          .pipe(
            Effect.mapError((cause) =>
              sessionFailure("Unable to delete session", sessionId, cause),
            ),
          );
        const index = yield* readIndex();
        yield* writeIndex(index.filter((id) => id !== sessionId));
      }),

    lastActivityTimestamp: (sessionId) =>
      Effect.gen(function* () {
        const session = yield* readSession(sessionId);
        return latestTimestamp(activeSegment(session).entries);
      }),

    segments,
  };
}

export const SessionsLocalStorage = (
  options?: SessionsLocalStorageOptions,
): Layer.Layer<Sessions, never, ObjectStorage> =>
  Layer.effect(
    Sessions,
    Effect.map(ObjectStorage, (storage) =>
      makeSessionsLocalStorage(storage, options),
    ),
  );
