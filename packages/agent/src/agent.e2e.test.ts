import { Agent } from "./agent.ts";
import * as LLM from "@bud/llm";
import { InMemory } from "@bud/object-storage";
import { Sessions, SessionsLocalStorage } from "@bud/sessions";
import { expect, it } from "@bud/testing";
import { Effect, Layer, Schema, Stream } from "effect";

function makeResponse(
  args: LLM.ProviderCallArgs,
  content: readonly LLM.AssistantContentPart[],
  finishReason: LLM.FinishReason = "stop",
): LLM.Response {
  return new LLM.Response({
    content,
    finishReason,
    providerId: "mock",
    modelId: args.modelId,
    providerModelName: "mock-model",
    inputMessages: args.messages,
    tools: [],
    toolSchemas: args.tools ?? [],
  });
}

function makeSessionsLayer() {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  return SessionsLocalStorage({
    namespace: "bud/agent-test",
    now,
  }).pipe(Layer.provide(InMemory.layer({ now })));
}

function makeModelLayer(provider: LLM.ProviderService) {
  return LLM.Model.layerWithDefaultPricing({ modelId: "mock/model" }).pipe(
    Layer.provide(LLM.ProviderRegistry.layer([{ scopes: "mock/", provider }])),
  );
}

function makeLayer(provider: LLM.ProviderService) {
  return Layer.mergeAll(
    makeSessionsLayer(),
    makeModelLayer(provider),
    LLM.ModelInfoDefault,
  );
}

it.effect("runs a prompt through sessions and hydrates stored media", () => {
  let observedMessages: readonly LLM.Message[] = [];

  const provider: LLM.ProviderService = {
    id: "mock",
    call: (args) =>
      Effect.sync(() => {
        observedMessages = args.messages;
        return makeResponse(args, [{ type: "text", text: "I can see it." }]);
      }),
    stream: () => Stream.empty,
  };

  return Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionId = "bud:agent-e2e";
    yield* sessions.create({ sessionId, modelId: "mock/model" });

    const agent = Agent.make({ systemPrompt: "You are Bud." });
    const response = yield* agent.prompt(
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

    expect(response.text).toBe("I can see it.");
    expect(observedMessages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    const userMessage = observedMessages[1];
    expect(userMessage?.role).toBe("user");
    if (userMessage?.role === "user") {
      expect(userMessage.content[0]).toMatchObject({
        type: "image",
        source: {
          type: "base64_image_source",
          data: "aGVsbG8=",
          mimeType: "image/png",
        },
      });
    }

    const entries = yield* sessions.segments.readActive(sessionId);
    const storedUser = entries.find((entry) => entry.type === "user_turn");
    expect(storedUser?.type).toBe("user_turn");
    if (storedUser?.type === "user_turn") {
      expect(storedUser.message.content[0]).toMatchObject({
        type: "image",
        source: {
          type: "object_storage_image_source",
          mimeType: "image/png",
        },
      });
    }

    const turns = yield* sessions.turns(sessionId);
    expect(turns.map((turn) => turn.type)).toEqual([
      "user_turn",
      "assistant_turn",
    ]);
  }).pipe(Effect.provide(makeLayer(provider)));
});

it.effect("runs a tool loop and records the full exchange", () => {
  const add = LLM.defineTool({
    name: "add",
    description: "Add two numbers",
    schema: Schema.Struct({
      a: Schema.Number,
      b: Schema.Number,
    }),
    tool: ({ a, b }) => LLM.toolResult({ sum: a + b }),
  });

  let callCount = 0;
  const observedRoles: LLM.Message["role"][][] = [];

  const provider: LLM.ProviderService = {
    id: "mock",
    call: (args) =>
      Effect.sync(() => {
        callCount++;
        observedRoles.push(args.messages.map((message) => message.role));

        if (callCount === 1) {
          return makeResponse(
            args,
            [
              {
                type: "tool_call",
                id: "call_add",
                name: "add",
                args: JSON.stringify({ a: 2, b: 3 }),
              },
            ],
            "tool_use",
          );
        }

        const last = args.messages.at(-1);
        expect(last?.role).toBe("user");
        if (last?.role === "user") {
          expect(last.content[0]).toMatchObject({
            type: "tool_output",
            id: "call_add",
            name: "add",
            isError: false,
            result: '{"sum":5}',
          });
        }

        return makeResponse(args, [{ type: "text", text: "The sum is 5." }]);
      }),
    stream: () => Stream.empty,
  };

  return Effect.gen(function* () {
    const sessions = yield* Sessions;
    const sessionId = "bud:agent-tools";
    yield* sessions.create({ sessionId, modelId: "mock/model" });

    const agent = Agent.make({
      systemPrompt: "You are Bud.",
      tools: [add],
    });
    const response = yield* agent.prompt(sessionId, LLM.user("2 + 3?"));

    expect(response.text).toBe("The sum is 5.");
    expect(callCount).toBe(2);
    expect(observedRoles).toEqual([
      ["system", "user"],
      ["system", "user", "assistant", "user"],
    ]);

    const turns = yield* sessions.turns(sessionId);
    expect(turns.map((turn) => turn.type)).toEqual([
      "user_turn",
      "assistant_turn",
      "user_turn",
      "assistant_turn",
    ]);

    const messages = yield* sessions.messages(sessionId, {
      systemPrompt: "You are Bud.",
    });
    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "The sum is 5." }],
    });
  }).pipe(Effect.provide(makeLayer(provider)));
});
