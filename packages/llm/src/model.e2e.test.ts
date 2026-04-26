import * as LLM from "./index.ts";
import { expect, it } from "@bud/testing";
import { Effect, Layer, Schema, Stream } from "effect";

it.effect("runs a model call through tool execution and resume", () => {
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

  const provider: LLM.ProviderService = {
    id: "mock",
    call: (args) =>
      Effect.sync(() => {
        callCount++;
        if (callCount === 1) {
          return new LLM.Response({
            content: [
              {
                type: "tool_call",
                id: "call_1",
                name: "add",
                args: JSON.stringify({ a: 2, b: 3 }),
              },
            ],
            finishReason: "tool_use",
            providerId: "mock",
            modelId: args.modelId,
            providerModelName: "mock-model",
            inputMessages: args.messages,
            tools: [],
            toolSchemas: args.tools ?? [],
          });
        }

        const last = args.messages.at(-1);
        expect(last?.role).toBe("user");
        if (last?.role !== "user") {
          throw new Error("Expected final message to be a user message");
        }
        expect(last.content[0]?.type).toBe("tool_output");

        return new LLM.Response({
          content: [{ type: "text", text: "The sum is 5." }],
          finishReason: "stop",
          providerId: "mock",
          modelId: args.modelId,
          providerModelName: "mock-model",
          inputMessages: args.messages,
          tools: [],
          toolSchemas: args.tools ?? [],
        });
      }),
    stream: () => Stream.empty,
  };

  const layer = LLM.Model.layerWithDefaultPricing({
    modelId: "mock/model",
  }).pipe(
    Layer.provide(LLM.ProviderRegistry.layer([{ scopes: "mock/", provider }])),
  );

  return Effect.gen(function* () {
    const model = yield* LLM.Model;
    const response = yield* model.call({
      content: "What is two plus three?",
      tools: [add],
    });

    expect(response.tools).toHaveLength(1);
    const parts = yield* response.executeTools();
    expect(parts[0]).toMatchObject({
      type: "tool_output",
      id: "call_1",
      name: "add",
      isError: false,
      result: '{"sum":5}',
    });

    const final = yield* response.resume(parts);
    expect(final.text).toBe("The sum is 5.");
    expect(callCount).toBe(2);
  }).pipe(Effect.provide(layer));
});

it.effect("accumulates streaming chunks into a response", () => {
  const provider: LLM.ProviderService = {
    id: "mock",
    call: () =>
      Effect.succeed(
        new LLM.Response({
          providerId: "mock",
          modelId: "mock/model",
          providerModelName: "mock-model",
          inputMessages: [],
          tools: [],
          toolSchemas: [],
        }),
      ),
    stream: () =>
      Stream.fromIterable([
        LLM.textStart(),
        LLM.textChunk("hello"),
        LLM.textChunk(" world"),
        LLM.textEnd(),
        LLM.usageDeltaChunk({ inputTokens: 7, outputTokens: 2 }),
        LLM.finishReasonChunk("stop"),
      ]),
  };

  const layer = LLM.Model.layerWithDefaultPricing({
    modelId: "mock/model",
  }).pipe(
    Layer.provide(LLM.ProviderRegistry.layer([{ scopes: "mock/", provider }])),
  );

  return Effect.gen(function* () {
    const model = yield* LLM.Model;
    const response = yield* model.stream({ content: "Say hello" });
    yield* response.consume();

    expect(response.consumed).toBe(true);
    expect(response.text).toBe("hello world");
    expect(response.usage.tokens.input).toBe(7);
    expect(response.usage.tokens.output).toBe(2);
  }).pipe(Effect.provide(layer));
});
