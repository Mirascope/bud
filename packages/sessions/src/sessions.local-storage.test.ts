import { Sessions, SessionsLocalStorage } from "./index.ts";
import * as LLM from "@bud/llm";
import { InMemory } from "@bud/object-storage";
import { expect, it } from "@bud/testing";
import { Effect, Layer, Stream } from "effect";

function makeLayer() {
  let tick = 0;
  return SessionsLocalStorage({
    namespace: "bud/sessions/test",
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  }).pipe(
    Layer.provide(
      InMemory.layer({
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
      }),
    ),
  );
}

function response(text: string, costCenticents = 0): LLM.Response {
  return new LLM.Response({
    content: [{ type: "text", text }],
    usage: {
      tokens: {
        input: 10,
        output: 4,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        costCenticents,
      },
      tools: [],
      costCenticents,
    },
    providerId: "mock",
    modelId: "mock/model",
    providerModelName: "mock-model",
    inputMessages: [],
    tools: [],
    toolSchemas: [],
  });
}

it.effect("persists turns and rebuilds messages", () =>
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionId = "bud:test-session";

    const header = yield* sessions.create({
      sessionId,
      modelId: "mock/model",
    });
    expect(header.segmentIndex).toBe(0);

    yield* sessions.addUserTurn(sessionId, LLM.user("hello"));
    yield* sessions.addAssistantTurn(sessionId, response("hi there", 125));

    const messages = yield* sessions.messages(sessionId, {
      systemPrompt: "You are helpful.",
    });
    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(messages[2]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "hi there" }],
    });

    const summary = yield* sessions.summarize("bud");
    expect(summary).toHaveLength(1);
    expect(summary[0]?.costCenticents.lifetime).toBe(125);
  }).pipe(Effect.provide(makeLayer())),
);

it.effect(
  "stores base64 media as object references and hydrates messages",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const sessionId = "bud:test-session";

      yield* sessions.create({ sessionId, modelId: "mock/model" });
      yield* sessions.addUserTurn(
        sessionId,
        LLM.user([
          {
            type: "image",
            source: {
              type: "base64_image_source",
              data: "aGVsbG8=",
              mimeType: "image/png",
            },
          },
        ]),
      );

      const entries = yield* sessions.segments.readActive(sessionId);
      const storedTurn = entries.find((entry) => entry.type === "user_turn");
      expect(storedTurn?.type).toBe("user_turn");
      if (storedTurn?.type === "user_turn") {
        expect(storedTurn.message.content[0]).toMatchObject({
          type: "image",
          source: {
            type: "object_storage_image_source",
            mimeType: "image/png",
          },
        });
      }

      const messages = yield* sessions.messages(sessionId);
      expect(messages[0]?.role).toBe("user");
      if (messages[0]?.role === "user") {
        expect(messages[0].content[0]).toMatchObject({
          type: "image",
          source: {
            type: "base64_image_source",
            data: "aGVsbG8=",
            mimeType: "image/png",
          },
        });
      }
    }).pipe(Effect.provide(makeLayer())),
);

it.effect("stores prompt snapshots and model metadata updates", () =>
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionId = "bud:test-session";

    const { hash } = yield* sessions.writePromptSnapshot("System prompt", [
      {
        name: "lookup",
        description: "Lookup a value",
        parameters: { type: "object" },
      },
    ]);
    yield* sessions.create({
      sessionId,
      modelId: "mock/old",
      systemPromptHash: hash,
    });
    yield* sessions.recordSystemPrompt(sessionId, hash);
    yield* sessions.updateModel(sessionId, "mock/new", "medium");

    const snapshot = yield* sessions.getPromptSnapshot(hash);
    expect(snapshot?.systemPrompt).toBe("System prompt");
    expect(snapshot?.tools[0]?.name).toBe("lookup");
    expect(yield* sessions.currentModelId(sessionId)).toBe("mock/new");
    expect(yield* sessions.currentThinkingLevel(sessionId)).toBe("medium");
  }).pipe(Effect.provide(makeLayer())),
);

it.effect("lists and scans segments", () =>
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionId = "bud:test-session";

    yield* sessions.create({ sessionId, modelId: "mock/model" });
    yield* sessions.addUserTurn(sessionId, LLM.user("first"));
    yield* sessions.addAssistantTurn(sessionId, response("reply"));
    yield* sessions.clear(sessionId);
    yield* sessions.addUserTurn(sessionId, LLM.user("second"));

    const segments = yield* sessions.segments.list(sessionId);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.turnCount).toBe(2);
    expect(segments[1]?.turnCount).toBe(1);

    const active = yield* sessions.segments.readActive(sessionId);
    expect(active.at(-1)?.type).toBe("user_turn");

    const scanned = yield* sessions.segments.scan(sessionId, {
      segmentIndex: 0,
      order: "desc",
      limit: 1,
    });
    expect(scanned.segmentCount).toBe(2);
    expect(scanned.segmentIndex).toBe(0);
    expect(scanned.entries).toHaveLength(1);
    expect(scanned.entries[0]?.type).toBe("assistant_turn");
  }).pipe(Effect.provide(makeLayer())),
);

it.effect("drops the most recent user/assistant exchange", () =>
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionId = "bud:test-session";

    yield* sessions.create({ sessionId, modelId: "mock/model" });
    yield* sessions.addUserTurn(sessionId, LLM.user("one"));
    yield* sessions.addAssistantTurn(sessionId, response("two"));
    yield* sessions.addUserTurn(sessionId, LLM.user("three"));

    const dropped = yield* sessions.dropLastExchange(sessionId);
    expect(dropped).toBe(1);

    const messages = yield* sessions.messages(sessionId);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  }).pipe(Effect.provide(makeLayer())),
);

it.effect(
  "compacts into a new segment and carries a trailing user turn",
  () => {
    const provider: LLM.ProviderService = {
      id: "mock",
      call: (args) =>
        Effect.succeed(
          new LLM.Response({
            content: [{ type: "text", text: "Earlier conversation summary." }],
            providerId: "mock",
            modelId: args.modelId,
            providerModelName: "mock-model",
            inputMessages: args.messages,
            tools: [],
            toolSchemas: args.tools ?? [],
          }),
        ),
      stream: () => Stream.empty,
    };

    const modelLayer = LLM.Model.layerWithDefaultPricing({
      modelId: "mock/model",
    }).pipe(
      Layer.provide(
        LLM.ProviderRegistry.layer([{ scopes: "mock/", provider }]),
      ),
    );

    return Effect.gen(function* () {
      const sessions = yield* Sessions;
      const sessionId = "bud:test-session";

      yield* sessions.create({ sessionId, modelId: "mock/model" });
      yield* sessions.addUserTurn(sessionId, LLM.user("please answer this"));

      const messages = yield* sessions.compact(sessionId, {
        contextWindowTokens: 128_000,
        systemPrompt: "You are helpful.",
      });
      const segments = yield* sessions.segments.list(sessionId);

      expect(segments).toHaveLength(2);
      expect(segments[1]?.hasCompaction).toBe(true);
      expect(messages.map((message) => message.role)).toEqual([
        "system",
        "user",
      ]);
      expect(messages[1]?.role).toBe("user");
      if (messages[1]?.role === "user") {
        expect(messages[1].content[0]).toMatchObject({
          type: "text",
          text: expect.stringContaining("please answer this"),
        });
      }
    }).pipe(Effect.provide(Layer.merge(makeLayer(), modelLayer)));
  },
);
