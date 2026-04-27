import * as LLM from "../index.ts";
import {
  WEB_LLM_DEFAULT_MODEL_ID,
  WEB_LLM_GEMMA_4_MODEL_ID,
  WEB_LLM_GEMMA_4_MODEL_RECORD,
  WEB_LLM_FUNCTION_CALLING_MODEL_IDS,
  WEB_LLM_HERMES_3_MODEL_ID,
  WebLLMDefaultAppConfig,
  makeWebLLMProvider,
  type WebLLMEngine,
} from "./provider.web-llm.ts";
import { expect, it } from "@bud/testing";
import type { ChatCompletionChunk } from "@mlc-ai/web-llm";
import { Effect, Stream } from "effect";

function mockEngine(
  create: WebLLMEngine["chat"]["completions"]["create"],
): WebLLMEngine {
  return {
    chat: {
      completions: { create },
    },
  };
}

function webLLMStreamThatDoesNotClose(
  chunks: readonly ChatCompletionChunk[],
): () => AsyncIterable<ChatCompletionChunk> {
  return () => ({
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < chunks.length) {
            return { done: false, value: chunks[index++]! };
          }
          await new Promise<never>(() => {});
          throw new Error("unreachable");
        },
        async return() {
          await new Promise<never>(() => {});
          throw new Error("unreachable");
        },
      };
    },
  });
}

const computerTool = {
  name: "computer",
  description: "Run a command",
  parameters: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

it("configures Hermes 3 as the default browser model", () => {
  expect(WEB_LLM_DEFAULT_MODEL_ID).toBe("Hermes-3-Llama-3.1-8B-q4f16_1-MLC");
  expect(WEB_LLM_HERMES_3_MODEL_ID).toBe("Hermes-3-Llama-3.1-8B-q4f16_1-MLC");
  expect(WebLLMDefaultAppConfig.useIndexedDBCache).toBe(true);
  expect(
    WebLLMDefaultAppConfig.model_list.some(
      (model) => model.model_id === WEB_LLM_HERMES_3_MODEL_ID,
    ),
  ).toBe(true);
  expect(WEB_LLM_FUNCTION_CALLING_MODEL_IDS.length).toBeGreaterThan(0);
  expect(
    WEB_LLM_FUNCTION_CALLING_MODEL_IDS.every((modelId) =>
      modelId.startsWith("Hermes-3-"),
    ),
  ).toBe(true);
  expect(
    WEB_LLM_FUNCTION_CALLING_MODEL_IDS.some((modelId) =>
      modelId.startsWith("Hermes-2-"),
    ),
  ).toBe(false);
});

it("keeps the custom Gemma 4 record available", () => {
  expect(WEB_LLM_GEMMA_4_MODEL_ID).toBe("gemma-4-E2B-it-q4f16_1-MLC");
  expect(WEB_LLM_GEMMA_4_MODEL_RECORD).toMatchInlineSnapshot(`
{
  "model": "https://huggingface.co/welcoma/gemma-4-E2B-it-q4f16_1-MLC",
  "model_id": "gemma-4-E2B-it-q4f16_1-MLC",
  "model_lib": "https://huggingface.co/welcoma/gemma-4-E2B-it-q4f16_1-MLC/resolve/main/libs/gemma-4-E2B-it-q4f16_1-MLC-webgpu.wasm",
  "overrides": {
    "sliding_window_size": -1,
  },
  "required_features": [
    "shader-f16",
  ],
}
`);
});

it.effect("does not alias unsupported Gemma 4 to the default local model", () =>
  Effect.gen(function* () {
    const provider = makeWebLLMProvider({
      modelId: WEB_LLM_HERMES_3_MODEL_ID,
      engine: mockEngine(async () => {
        throw new Error("engine should not be reached");
      }),
    });

    const exit = yield* Effect.exit(
      provider.call({
        modelId: "web-llm/gemma-4",
        messages: [LLM.user("Use the tool")],
        tools: [computerTool],
      }),
    );
    expect(exit.toString()).toContain(
      "gemma-4 does not support tool use in WebLLM",
    );
  }),
);

it.effect("calls WebLLM through the OpenAI chat completions shape", () =>
  Effect.gen(function* () {
    let request: unknown;
    const provider = makeWebLLMProvider({
      engine: mockEngine(async (body) => {
        request = body;
        return {
          id: "chatcmpl_1",
          object: "chat.completion",
          created: 0,
          model: WEB_LLM_HERMES_3_MODEL_ID,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "pong" },
              finish_reason: "stop",
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
            extra: {
              e2e_latency_s: 0,
              prefill_tokens_per_s: 0,
              decode_tokens_per_s: 0,
              time_to_first_token_s: 0,
              time_per_output_token_s: 0,
            },
          },
        };
      }),
    });

    const response = yield* provider.call({
      modelId: "web-llm/local",
      messages: [LLM.system("You are terse."), LLM.user("Return pong")],
      params: { maxTokens: 32, temperature: 0 },
    });

    expect(request).toMatchInlineSnapshot(`
{
  "max_tokens": 32,
  "messages": [
    {
      "content": "You are terse.",
      "role": "system",
    },
    {
      "content": "Return pong",
      "role": "user",
    },
  ],
  "model": "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
  "stream": false,
  "temperature": 0,
}
`);
    expect(response.providerId).toBe("web-llm");
    expect(response.providerModelName).toBe(WEB_LLM_HERMES_3_MODEL_ID);
    expect(response.text).toBe("pong");
    expect(response.usage.tokens.output).toBe(2);
  }),
);

it.effect(
  "streams WebLLM chunks through the shared chat completions decoder",
  () =>
    Effect.gen(function* () {
      async function* chunks(): AsyncGenerator<ChatCompletionChunk> {
        yield {
          id: "chatcmpl_1",
          object: "chat.completion.chunk" as const,
          created: 0,
          model: WEB_LLM_HERMES_3_MODEL_ID,
          choices: [
            { index: 0, delta: { content: "po" }, finish_reason: null },
          ],
        };
        yield {
          id: "chatcmpl_1",
          object: "chat.completion.chunk" as const,
          created: 0,
          model: WEB_LLM_HERMES_3_MODEL_ID,
          choices: [
            { index: 0, delta: { content: "ng" }, finish_reason: null },
          ],
        };
        yield {
          id: "chatcmpl_1",
          object: "chat.completion.chunk" as const,
          created: 0,
          model: WEB_LLM_HERMES_3_MODEL_ID,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
            extra: {
              e2e_latency_s: 0,
              prefill_tokens_per_s: 0,
              decode_tokens_per_s: 0,
              time_to_first_token_s: 0,
              time_per_output_token_s: 0,
            },
          },
        };
      }

      const provider = makeWebLLMProvider({
        engine: mockEngine(async () => chunks()),
      });

      const responseChunks = yield* Stream.runCollect(
        provider.stream({
          modelId: "web-llm/local",
          messages: [LLM.user("Return pong")],
        }),
      );
      const text = Array.from(responseChunks)
        .filter((chunk): chunk is LLM.TextChunk => chunk.type === "text_chunk")
        .map((chunk) => chunk.delta)
        .join("");

      expect(text).toBe("pong");
      expect(
        Array.from(responseChunks).some(
          (chunk) => chunk.type === "finish_reason_chunk",
        ),
      ).toBe(true);
    }),
);

it.effect("finishes WebLLM streams when a finish reason arrives", () =>
  Effect.gen(function* () {
    const chunks = webLLMStreamThatDoesNotClose([
      {
        id: "chatcmpl_1",
        object: "chat.completion.chunk" as const,
        created: 0,
        model: WEB_LLM_HERMES_3_MODEL_ID,
        choices: [
          { index: 0, delta: { content: "done" }, finish_reason: null },
        ],
      },
      {
        id: "chatcmpl_1",
        object: "chat.completion.chunk" as const,
        created: 0,
        model: WEB_LLM_HERMES_3_MODEL_ID,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ]);

    const provider = makeWebLLMProvider({
      engine: mockEngine(async () => chunks()),
    });

    const responseChunks = yield* Stream.runCollect(
      provider.stream({
        modelId: "web-llm/local",
        messages: [LLM.user("Return done")],
      }),
    );
    const chunksArray = Array.from(responseChunks);
    const text = chunksArray
      .filter((chunk): chunk is LLM.TextChunk => chunk.type === "text_chunk")
      .map((chunk) => chunk.delta)
      .join("");

    expect(text).toBe("done");
    expect(chunksArray.at(-1)?.type).toBe("raw_message_chunk");
  }),
);

it.effect("passes tools through for WebLLM function calling models", () =>
  Effect.gen(function* () {
    let request: unknown;
    const provider = makeWebLLMProvider({
      engine: mockEngine(async (body) => {
        request = body;
        return {
          id: "chatcmpl_1",
          object: "chat.completion",
          created: 0,
          model: WEB_LLM_HERMES_3_MODEL_ID,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
            extra: {
              e2e_latency_s: 0,
              prefill_tokens_per_s: 0,
              decode_tokens_per_s: 0,
              time_to_first_token_s: 0,
              time_per_output_token_s: 0,
            },
          },
        };
      }),
    });

    yield* provider.call({
      modelId: "web-llm/local",
      messages: [LLM.user("Use the tool")],
      tools: [computerTool],
    });

    expect(request).toMatchInlineSnapshot(`
{
  "max_tokens": 4096,
  "messages": [
    {
      "content": "Use the tool",
      "role": "user",
    },
  ],
  "model": "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
  "stream": false,
  "tools": [
    {
      "function": {
        "description": "Run a command",
        "name": "computer",
        "parameters": {
          "properties": {},
          "required": [],
          "type": "object",
        },
      },
      "type": "function",
    },
  ],
}
`);
  }),
);

it.effect(
  "retries WebLLM call without tools when tool parsing rejects text",
  () =>
    Effect.gen(function* () {
      const requests: unknown[] = [];
      const provider = makeWebLLMProvider({
        engine: mockEngine(async (body) => {
          requests.push(body);
          if (requests.length === 1) {
            throw new Error(
              'ToolCallOutputParseError: Got error: SyntaxError: Unexpected token H, "Hello!" is not valid JSON',
            );
          }
          return {
            id: "chatcmpl_1",
            object: "chat.completion",
            created: 0,
            model: WEB_LLM_HERMES_3_MODEL_ID,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Hello!" },
                finish_reason: "stop",
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
              extra: {
                e2e_latency_s: 0,
                prefill_tokens_per_s: 0,
                decode_tokens_per_s: 0,
                time_to_first_token_s: 0,
                time_per_output_token_s: 0,
              },
            },
          };
        }),
      });

      const response = yield* provider.call({
        modelId: "web-llm/local",
        messages: [LLM.user("Say hello")],
        tools: [computerTool],
      });

      expect(response.text).toBe("Hello!");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toHaveProperty("tools");
      expect(requests[1]).not.toHaveProperty("tools");
    }),
);

it.effect(
  "retries WebLLM stream without tools when streamed tool parsing rejects text",
  () =>
    Effect.gen(function* () {
      const requests: unknown[] = [];

      async function* rejectedChunks(): AsyncGenerator<ChatCompletionChunk> {
        yield {
          id: "chatcmpl_1",
          object: "chat.completion.chunk" as const,
          created: 0,
          model: WEB_LLM_HERMES_3_MODEL_ID,
          choices: [],
        };
        throw new Error(
          'ToolCallOutputParseError: Got error: SyntaxError: Unexpected token H, "Hello!" is not valid JSON',
        );
      }

      async function* fallbackChunks(): AsyncGenerator<ChatCompletionChunk> {
        yield {
          id: "chatcmpl_1",
          object: "chat.completion.chunk" as const,
          created: 0,
          model: WEB_LLM_HERMES_3_MODEL_ID,
          choices: [
            { index: 0, delta: { content: "Hello!" }, finish_reason: null },
          ],
        };
        yield {
          id: "chatcmpl_1",
          object: "chat.completion.chunk" as const,
          created: 0,
          model: WEB_LLM_HERMES_3_MODEL_ID,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
            extra: {
              e2e_latency_s: 0,
              prefill_tokens_per_s: 0,
              decode_tokens_per_s: 0,
              time_to_first_token_s: 0,
              time_per_output_token_s: 0,
            },
          },
        };
      }

      const provider = makeWebLLMProvider({
        engine: mockEngine(async (body) => {
          requests.push(body);
          return requests.length === 1 ? rejectedChunks() : fallbackChunks();
        }),
      });

      const responseChunks = yield* Stream.runCollect(
        provider.stream({
          modelId: "web-llm/local",
          messages: [LLM.user("Say hello")],
          tools: [computerTool],
        }),
      );
      const text = Array.from(responseChunks)
        .filter((chunk): chunk is LLM.TextChunk => chunk.type === "text_chunk")
        .map((chunk) => chunk.delta)
        .join("");

      expect(text).toBe("Hello!");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toHaveProperty("tools");
      expect(requests[1]).not.toHaveProperty("tools");
    }),
);
