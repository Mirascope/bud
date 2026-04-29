import { Bud } from "./bud.ts";
import { CronMemory } from "./spiders/cron.memory.ts";
import { GatewaySpider } from "./spiders/gateway.spider.ts";
import { IdentityMemory } from "./spiders/identity.memory.ts";
import { JournalMemory } from "./spiders/journal.memory.ts";
import {
  Computer,
  makeComputerError,
  type ComputerService,
} from "@bud/computer";
import * as LLM from "@bud/llm";
import { InMemory } from "@bud/object-storage";
import { Sessions, SessionsLocalStorage } from "@bud/sessions";
import { expect, it } from "@bud/testing";
import { Effect, Layer, Stream } from "effect";

const sessionId = "bud:test";

function makeComputer(): ComputerService {
  return {
    list: () => Effect.succeed([]),
    stat: () => Effect.succeed(null),
    read: (path) =>
      Effect.fail(makeComputerError({ message: "not found", path })),
    write: () =>
      Effect.fail(makeComputerError({ message: "write not implemented" })),
    edit: () =>
      Effect.fail(makeComputerError({ message: "edit not implemented" })),
    remove: () => Effect.void,
    startTerminal: () =>
      Effect.fail(makeComputerError({ message: "terminal not implemented" })),
    writeTerminal: () => Effect.void,
    readTerminal: () =>
      Effect.succeed({
        terminalId: "terminal",
        output: "",
        status: "exited",
      }),
    killTerminal: () => Effect.void,
  };
}

function makeLayer(provider: LLM.ProviderService): Layer.Layer<Bud | Sessions> {
  const registry = LLM.ProviderRegistry.layer([{ scopes: "mock/", provider }]);
  const model = LLM.Model.layerWithDefaultPricing({
    modelId: "mock/model",
  }).pipe(Layer.provide(registry));
  const sessions = SessionsLocalStorage().pipe(Layer.provide(InMemory.layer()));

  return Layer.mergeAll(
    Bud.layer({
      systemPrompt: "You are Bud.",
      modelId: "mock/model",
      includeDomainTools: false,
    }),
    sessions,
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        sessions,
        model,
        LLM.ModelInfoDefault,
        IdentityMemory(),
        JournalMemory(),
        CronMemory(),
        GatewaySpider(),
        Layer.succeed(Computer, makeComputer()),
      ),
    ),
  );
}

it.effect("runs Bud prompts through the agent and sessions", () => {
  const provider: LLM.ProviderService = {
    id: "mock",
    call: (args) =>
      Effect.succeed(
        new LLM.Response({
          content: [{ type: "text", text: "hello from bud" }],
          providerId: "mock",
          modelId: args.modelId,
          providerModelName: "model",
          inputMessages: [...args.messages],
          tools: [],
          toolSchemas: [],
        }),
      ),
    stream: () => Stream.empty,
  };

  return Effect.gen(function* () {
    const bud = yield* Bud;
    const sessions = yield* Sessions;
    const response = yield* bud.prompt({
      sessionId,
      message: "hello",
    });
    const turns = yield* sessions.turns(sessionId);

    expect(response.text).toBe("hello from bud");
    expect(turns.map((turn) => turn.type)).toEqual([
      "user_turn",
      "assistant_turn",
    ]);
  }).pipe(Effect.provide(makeLayer(provider)));
});

it.effect("streams Bud turns through the agent stream", () => {
  const provider: LLM.ProviderService = {
    id: "mock",
    call: () =>
      Effect.fail(
        new LLM.ProviderError({
          message: "call not implemented",
          providerId: "mock",
          kind: "unknown",
        }),
      ),
    stream: () =>
      Stream.fromIterable([
        LLM.textStart(),
        LLM.textChunk("streamed"),
        LLM.textEnd(),
        LLM.usageDeltaChunk({ inputTokens: 3, outputTokens: 1 }),
        LLM.finishReasonChunk("stop"),
      ]),
  };

  return Effect.gen(function* () {
    const bud = yield* Bud;
    const stream = yield* bud.stream({
      sessionId,
      message: "hello",
    });
    const events = yield* Stream.runCollect(stream);

    expect(
      Array.from(events)
        .filter((event) => event.type === "text")
        .map((event) => event.delta)
        .join(""),
    ).toBe("streamed");
    expect(Array.from(events).some((event) => event.type === "done")).toBe(
      true,
    );
  }).pipe(Effect.provide(makeLayer(provider)));
});
