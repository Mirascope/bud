import type { UserContentPart } from "../content/index.ts";
import { ProviderError } from "../providers/provider.schemas.ts";
import type { StreamResponseChunk } from "./chunks.ts";
import {
  TextContentStream,
  ThoughtContentStream,
  ToolCallContentStream,
  type ContentStream,
} from "./content-stream.ts";
import { Response, type ResponseInit } from "./response.ts";
import { createUsage, type Usage } from "./usage.ts";
import { Effect, Option, Queue, Stream } from "effect";

// ---------------------------------------------------------------------------
// Chunk processing state
// ---------------------------------------------------------------------------

interface ChunkState {
  activeText: string | null;
  activeThought: string | null;
  activeToolCalls: Map<
    string,
    { id: string; name: string; args: string; thoughtSignature?: string }
  >;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

type ContentStreamQueueItem =
  | { readonly type: "content"; readonly stream: ContentStream }
  | { readonly type: "error"; readonly error: ProviderError }
  | { readonly type: "done" };

// ---------------------------------------------------------------------------
// StreamResponseInit
// ---------------------------------------------------------------------------

export interface StreamResponseInit
  extends Pick<
    ResponseInit,
    | "providerId"
    | "modelId"
    | "providerModelName"
    | "inputMessages"
    | "tools"
    | "toolSchemas"
  > {
  readonly stream: Stream.Stream<StreamResponseChunk, ProviderError>;
  readonly computeCost?: (usage: Usage) => number;
}

// ---------------------------------------------------------------------------
// StreamResponse
// ---------------------------------------------------------------------------

/** A streaming response from an LLM call. Once consumed, behaves like a Response. */
export class StreamResponse extends Response {
  readonly stream: Stream.Stream<StreamResponseChunk, ProviderError>;
  private _consumed = false;
  private readonly _computeCost?: (usage: Usage) => number;
  private readonly _chunkState: ChunkState = {
    activeText: null,
    activeThought: null,
    activeToolCalls: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };

  constructor(init: StreamResponseInit) {
    super({
      providerId: init.providerId,
      modelId: init.modelId,
      providerModelName: init.providerModelName,
      inputMessages: init.inputMessages,
      tools: init.tools,
      toolSchemas: init.toolSchemas,
    });
    this.stream = init.stream;
    this._computeCost = init.computeCost;
  }

  get consumed(): boolean {
    return this._consumed;
  }

  // ---------------------------------------------------------------------------
  // Consumption methods
  // ---------------------------------------------------------------------------

  forEach(
    f: (chunk: StreamResponseChunk) => Effect.Effect<void>,
  ): Effect.Effect<void, ProviderError> {
    return Stream.runForEach(this.stream, (chunk) =>
      Effect.gen(this, function* () {
        this._processChunk(chunk);
        yield* f(chunk);
      }),
    ).pipe(Effect.tap(() => Effect.sync(() => this._finalize())));
  }

  consume(): Effect.Effect<void, ProviderError> {
    return Stream.runForEach(this.stream, (chunk) =>
      Effect.sync(() => this._processChunk(chunk)),
    ).pipe(Effect.tap(() => Effect.sync(() => this._finalize())));
  }

  // ---------------------------------------------------------------------------
  // Sub-streams
  // ---------------------------------------------------------------------------

  textStream(): Stream.Stream<string, ProviderError> {
    return this._accumulatingStream().pipe(
      Stream.filterMap((chunk) =>
        chunk.type === "text_chunk" ? Option.some(chunk.delta) : Option.none(),
      ),
    );
  }

  thoughtStream(): Stream.Stream<string, ProviderError> {
    return this._accumulatingStream().pipe(
      Stream.filterMap((chunk) =>
        chunk.type === "thought_chunk"
          ? Option.some(chunk.delta)
          : Option.none(),
      ),
    );
  }

  streams(): Stream.Stream<ContentStream, ProviderError> {
    return Stream.unwrap(
      Effect.gen(this, function* () {
        const outerQueue = yield* Queue.unbounded<ContentStreamQueueItem>();

        yield* Effect.fork(
          Effect.gen(this, function* () {
            let innerQueue: Queue.Queue<string | null> | null = null;
            let currentContentStream: ContentStream | null = null;

            const closeInnerQueue = Effect.gen(function* () {
              if (innerQueue) {
                yield* Queue.offer(innerQueue, null);
                innerQueue = null;
                currentContentStream = null;
              }
            });

            yield* Stream.runForEach(this.stream, (chunk) =>
              Effect.gen(this, function* () {
                this._processChunk(chunk);

                switch (chunk.type) {
                  case "text_start_chunk": {
                    innerQueue = yield* Queue.unbounded<string | null>();
                    const deltaStream = Stream.fromQueue(innerQueue).pipe(
                      Stream.takeWhile((v): v is string => v !== null),
                    );
                    currentContentStream = new TextContentStream(deltaStream);
                    yield* Queue.offer(outerQueue, {
                      type: "content",
                      stream: currentContentStream,
                    });
                    break;
                  }
                  case "text_chunk":
                    if (innerQueue && currentContentStream?.type === "text") {
                      currentContentStream.partialText += chunk.delta;
                      yield* Queue.offer(innerQueue, chunk.delta);
                    }
                    break;
                  case "text_end_chunk":
                    yield* closeInnerQueue;
                    break;

                  case "thought_start_chunk": {
                    innerQueue = yield* Queue.unbounded<string | null>();
                    const deltaStream = Stream.fromQueue(innerQueue).pipe(
                      Stream.takeWhile((v): v is string => v !== null),
                    );
                    currentContentStream = new ThoughtContentStream(
                      deltaStream,
                    );
                    yield* Queue.offer(outerQueue, {
                      type: "content",
                      stream: currentContentStream,
                    });
                    break;
                  }
                  case "thought_chunk":
                    if (
                      innerQueue &&
                      currentContentStream?.type === "thought"
                    ) {
                      currentContentStream.partialThought += chunk.delta;
                      yield* Queue.offer(innerQueue, chunk.delta);
                    }
                    break;
                  case "thought_end_chunk":
                    yield* closeInnerQueue;
                    break;

                  case "tool_call_start_chunk": {
                    innerQueue = yield* Queue.unbounded<string | null>();
                    const deltaStream = Stream.fromQueue(innerQueue).pipe(
                      Stream.takeWhile((v): v is string => v !== null),
                    );
                    currentContentStream = new ToolCallContentStream(
                      chunk.id,
                      chunk.name,
                      deltaStream,
                    );
                    yield* Queue.offer(outerQueue, {
                      type: "content",
                      stream: currentContentStream,
                    });
                    break;
                  }
                  case "tool_call_chunk":
                    if (
                      innerQueue &&
                      currentContentStream?.type === "tool_call"
                    ) {
                      currentContentStream.partialArgs += chunk.delta;
                      yield* Queue.offer(innerQueue, chunk.delta);
                    }
                    break;
                  case "tool_call_end_chunk":
                    yield* closeInnerQueue;
                    break;

                  default:
                    break;
                }
              }),
            ).pipe(
              Effect.tap(() => Effect.sync(() => this._finalize())),
              Effect.catchAll((error) =>
                Queue.offer(outerQueue, { type: "error", error }),
              ),
              Effect.ensuring(
                Effect.gen(function* () {
                  yield* closeInnerQueue;
                  yield* Queue.offer(outerQueue, { type: "done" });
                }),
              ),
            );
          }),
        );

        return Stream.fromQueue(outerQueue).pipe(
          Stream.takeWhile((item) => item.type !== "done"),
          Stream.mapEffect((item) => {
            if (item.type === "content") return Effect.succeed(item.stream);
            if (item.type === "error") return Effect.fail(item.error);
            return Effect.fail(
              new ProviderError({
                message: "Unexpected end of content stream.",
                providerId: this.providerId,
                kind: "unknown",
              }),
            );
          }),
        );
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Resume
  // ---------------------------------------------------------------------------

  override resume(
    parts: readonly UserContentPart[],
  ): Effect.Effect<StreamResponse, ProviderError, import("../model.ts").Model> {
    const messages = this._buildResumeMessages(parts);
    const tools = this._tools;

    return Effect.gen(function* () {
      const { Model } = yield* Effect.promise(() => import("../model.ts")).pipe(
        Effect.orDie,
      );
      const model = yield* Model;
      return yield* model.stream({ content: messages, tools });
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _accumulatingStream(): Stream.Stream<
    StreamResponseChunk,
    ProviderError
  > {
    return Stream.mapEffect(this.stream, (chunk) =>
      Effect.sync(() => {
        this._processChunk(chunk);
        return chunk;
      }),
    ).pipe(Stream.ensuring(Effect.sync(() => this._finalize())));
  }

  private get _mut(): Record<string, unknown> {
    return this as unknown as Record<string, unknown>;
  }

  private _processChunk(chunk: StreamResponseChunk): void {
    const s = this._chunkState;

    switch (chunk.type) {
      case "text_start_chunk":
        s.activeText = "";
        break;
      case "text_chunk":
        if (s.activeText !== null) s.activeText += chunk.delta;
        break;
      case "text_end_chunk":
        if (s.activeText !== null) {
          (this.content as unknown[]).push({
            type: "text",
            text: s.activeText,
          });
          s.activeText = null;
        }
        break;

      case "thought_start_chunk":
        s.activeThought = "";
        break;
      case "thought_chunk":
        if (s.activeThought !== null) s.activeThought += chunk.delta;
        break;
      case "thought_end_chunk":
        if (s.activeThought !== null) {
          (this.content as unknown[]).push({
            type: "thought",
            thought: s.activeThought,
          });
          s.activeThought = null;
        }
        break;

      case "tool_call_start_chunk":
        s.activeToolCalls.set(chunk.id, {
          id: chunk.id,
          name: chunk.name,
          args: "",
          thoughtSignature: chunk.thoughtSignature,
        });
        break;
      case "tool_call_chunk": {
        const active = s.activeToolCalls.get(chunk.id);
        if (active) active.args += chunk.delta;
        break;
      }
      case "tool_call_end_chunk": {
        const tc = s.activeToolCalls.get(chunk.id);
        if (tc) {
          const toolCall: Record<string, unknown> = {
            type: "tool_call",
            id: tc.id,
            name: tc.name,
            args: tc.args,
          };
          if (tc.thoughtSignature) {
            toolCall.thoughtSignature = tc.thoughtSignature;
          }
          (this.content as unknown[]).push(toolCall);
          s.activeToolCalls.delete(tc.id);
        }
        break;
      }

      case "finish_reason_chunk":
        this._mut.finishReason = chunk.finishReason;
        break;

      case "usage_delta_chunk":
        s.inputTokens += chunk.inputTokens;
        s.outputTokens += chunk.outputTokens;
        s.cacheReadTokens += chunk.cacheReadTokens;
        s.cacheWriteTokens += chunk.cacheWriteTokens;
        s.reasoningTokens += chunk.reasoningTokens;
        break;

      case "raw_message_chunk":
        this._mut.rawMessage = chunk.rawMessage;
        break;

      case "raw_stream_event_chunk":
        break;
    }
  }

  private _finalize(): void {
    if (this._consumed) return;
    this._consumed = true;
    const s = this._chunkState;
    const usage = createUsage({
      tokens: {
        input: s.inputTokens,
        output: s.outputTokens,
        cacheRead: s.cacheReadTokens,
        cacheWrite: s.cacheWriteTokens,
        reasoning: s.reasoningTokens,
      },
    });
    if (this._computeCost) {
      (usage as { costCenticents: number }).costCenticents =
        this._computeCost(usage);
    }
    this._mut.usage = usage;
  }
}
