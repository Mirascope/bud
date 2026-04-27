import * as LLM from "../index.ts";
import { buildOpenAIChatCompletionsRequestBody } from "./provider.openai.completions.ts";
import { buildOpenAIResponsesRequestBody } from "./provider.openai.responses.ts";
import { makeOpenAIProvider } from "./provider.openai.ts";
import { createRecordIt, expect, it } from "@bud/testing";
import { Effect, Stream } from "effect";
import { existsSync } from "node:fs";
import { join } from "node:path";

const recordIt = createRecordIt(import.meta.dir, "openai");
const modelId = Bun.env.OPENAI_TEST_MODEL ?? "openai/gpt-4.1-mini";

function canRun(cassetteName: string): boolean {
  return (
    Boolean(Bun.env.OPENAI_API_KEY) ||
    existsSync(join(import.meta.dir, "cassettes", "openai", cassetteName))
  );
}

const callResponsesIt = canRun("calls-openai-responses-api.har")
  ? recordIt
  : recordIt.skip;
const streamResponsesIt = canRun("streams-openai-responses-api.har")
  ? recordIt
  : recordIt.skip;
const callCompletionsIt = canRun("calls-openai-chat-completions-api.har")
  ? recordIt
  : recordIt.skip;
const streamCompletionsIt = canRun("streams-openai-chat-completions-api.har")
  ? recordIt
  : recordIt.skip;

const lookupTool: LLM.ToolSchema = {
  name: "lookup",
  description: "Look something up.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(events: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function mockFetch(
  handler: (url: URL | RequestInfo, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return handler as typeof globalThis.fetch;
}

it("builds Responses request bodies", () => {
  const body = buildOpenAIResponsesRequestBody({
    modelId: "openai/gpt-4.1-mini",
    messages: [
      LLM.system("You are terse."),
      LLM.user("Find it"),
      LLM.assistant([
        { type: "tool_call", id: "call_1", name: "lookup", args: "{}" },
      ]),
      {
        role: "user",
        name: null,
        content: [
          {
            type: "tool_output",
            id: "call_1",
            name: "lookup",
            result: "found",
            isError: false,
          },
        ],
      },
    ],
    tools: [lookupTool],
    params: { maxTokens: 32, temperature: 0 },
  });

  expect(body).toMatchInlineSnapshot(`
{
  "input": [
    {
      "content": "You are terse.",
      "role": "system",
    },
    {
      "content": "Find it",
      "role": "user",
    },
    {
      "arguments": "{}",
      "call_id": "call_1",
      "name": "lookup",
      "type": "function_call",
    },
    {
      "call_id": "call_1",
      "output": "found",
      "type": "function_call_output",
    },
  ],
  "max_output_tokens": 32,
  "model": "gpt-4.1-mini",
  "temperature": 0,
  "tools": [
    {
      "description": "Look something up.",
      "name": "lookup",
      "parameters": {
        "properties": {
          "query": {
            "type": "string",
          },
        },
        "required": [
          "query",
        ],
        "type": "object",
      },
      "type": "function",
    },
  ],
}
`);
});

it("builds Chat Completions request bodies", () => {
  const body = buildOpenAIChatCompletionsRequestBody({
    modelId: "openai/gpt-4.1-mini",
    messages: [
      LLM.system("You are terse."),
      LLM.user("Find it"),
      LLM.assistant([
        { type: "tool_call", id: "call_1", name: "lookup", args: "{}" },
      ]),
      {
        role: "user",
        name: null,
        content: [
          {
            type: "tool_output",
            id: "call_1",
            name: "lookup",
            result: "found",
            isError: false,
          },
        ],
      },
    ],
    tools: [lookupTool],
    params: { maxTokens: 32, temperature: 0 },
  });

  expect(body).toMatchInlineSnapshot(`
{
  "max_tokens": 32,
  "messages": [
    {
      "content": "You are terse.",
      "role": "system",
    },
    {
      "content": "Find it",
      "role": "user",
    },
    {
      "role": "assistant",
      "tool_calls": [
        {
          "function": {
            "arguments": "{}",
            "name": "lookup",
          },
          "id": "call_1",
          "type": "function",
        },
      ],
    },
    {
      "content": "found",
      "role": "tool",
      "tool_call_id": "call_1",
    },
  ],
  "model": "gpt-4.1-mini",
  "temperature": 0,
  "tools": [
    {
      "function": {
        "description": "Look something up.",
        "name": "lookup",
        "parameters": {
          "properties": {
            "query": {
              "type": "string",
            },
          },
          "required": [
            "query",
          ],
          "type": "object",
        },
      },
      "type": "function",
    },
  ],
}
`);
});

it.effect("calls the Responses API", () =>
  Effect.gen(function* () {
    let requestUrl = "";
    const provider = makeOpenAIProvider({
      apiKey: "test-key",
      fetch: mockFetch(async (url) => {
        requestUrl = String(url);
        return jsonResponse({
          id: "resp_1",
          model: "gpt-4.1-mini-2026-01-01",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "pong" }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2 },
        });
      }),
    });

    const response = yield* provider.call({
      modelId: "openai/gpt-4.1-mini",
      messages: [LLM.user("Return pong")],
    });

    expect(requestUrl).toBe("https://api.openai.com/v1/responses");
    expect(response.text).toBe("pong");
    expect(response.usage.tokens.input).toBe(5);
  }),
);

it.effect("calls the Chat Completions API", () =>
  Effect.gen(function* () {
    let requestUrl = "";
    const provider = makeOpenAIProvider({
      apiKey: "test-key",
      mode: "chat-completions",
      baseURL: "https://compatible.example/v1",
      fetch: mockFetch(async (url) => {
        requestUrl = String(url);
        return jsonResponse({
          id: "chatcmpl_1",
          model: "compatible-model",
          choices: [
            {
              message: {
                role: "assistant",
                content: "pong",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        });
      }),
    });

    const response = yield* provider.call({
      modelId: "openai/gpt-4.1-mini",
      messages: [LLM.user("Return pong")],
    });

    expect(requestUrl).toBe("https://compatible.example/v1/chat/completions");
    expect(response.text).toBe("pong");
    expect(response.usage.tokens.output).toBe(2);
  }),
);

it.effect("streams the Responses API", () =>
  Effect.gen(function* () {
    const provider = makeOpenAIProvider({
      apiKey: "test-key",
      fetch: mockFetch(async () =>
        sseResponse([
          { type: "response.output_text.delta", delta: "po" },
          { type: "response.output_text.delta", delta: "ng" },
          { type: "response.output_text.done" },
          {
            type: "response.completed",
            response: {
              id: "resp_1",
              model: "gpt-4.1-mini",
              usage: { input_tokens: 5, output_tokens: 2 },
            },
          },
        ]),
      ),
    });

    const chunks = yield* Stream.runCollect(
      provider.stream({
        modelId: "openai/gpt-4.1-mini",
        messages: [LLM.user("Return pong")],
      }),
    );
    const text = Array.from(chunks)
      .filter((chunk): chunk is LLM.TextChunk => chunk.type === "text_chunk")
      .map((chunk) => chunk.delta)
      .join("");

    expect(text).toBe("pong");
    expect(
      Array.from(chunks).some((chunk) => chunk.type === "usage_delta_chunk"),
    ).toBe(true);
  }),
);

it.effect("streams the Chat Completions API", () =>
  Effect.gen(function* () {
    const provider = makeOpenAIProvider({
      apiKey: "test-key",
      mode: "chat-completions",
      fetch: mockFetch(async () =>
        sseResponse([
          { choices: [{ delta: { content: "po" } }] },
          { choices: [{ delta: { content: "ng" } }] },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 2 },
          },
        ]),
      ),
    });

    const chunks = yield* Stream.runCollect(
      provider.stream({
        modelId: "openai/gpt-4.1-mini",
        messages: [LLM.user("Return pong")],
      }),
    );
    const text = Array.from(chunks)
      .filter((chunk): chunk is LLM.TextChunk => chunk.type === "text_chunk")
      .map((chunk) => chunk.delta)
      .join("");

    expect(text).toBe("pong");
    expect(
      Array.from(chunks).some((chunk) => chunk.type === "finish_reason_chunk"),
    ).toBe(true);
  }),
);

callResponsesIt(
  "calls OpenAI Responses API",
  () =>
    Effect.gen(function* () {
      const provider = makeOpenAIProvider({
        apiKey: Bun.env.OPENAI_API_KEY ?? "cassette-key",
        mode: "responses",
      });

      const response = yield* provider.call({
        modelId,
        messages: [LLM.user("Return exactly the text: pong")],
        params: { maxTokens: 16, temperature: 0 },
      });

      expect(response.providerId).toBe("openai");
      expect(response.modelId).toBe(modelId);
      expect(response.text.toLowerCase()).toContain("pong");
      expect(response.usage.tokens.input).toBeGreaterThan(0);
    }),
  { timeout: 30_000 },
);

streamResponsesIt(
  "streams OpenAI Responses API",
  () =>
    Effect.gen(function* () {
      const provider = makeOpenAIProvider({
        apiKey: Bun.env.OPENAI_API_KEY ?? "cassette-key",
        mode: "responses",
      });

      const chunks = yield* Stream.runCollect(
        provider.stream({
          modelId,
          messages: [LLM.user("Return exactly the text: pong")],
          params: { maxTokens: 16, temperature: 0 },
        }),
      );

      const all = Array.from(chunks);
      const text = all
        .filter((chunk): chunk is LLM.TextChunk => chunk.type === "text_chunk")
        .map((chunk) => chunk.delta)
        .join("");

      expect(text.toLowerCase()).toContain("pong");
      expect(all.some((chunk) => chunk.type === "usage_delta_chunk")).toBe(
        true,
      );
    }),
  { timeout: 30_000 },
);

callCompletionsIt(
  "calls OpenAI Chat Completions API",
  () =>
    Effect.gen(function* () {
      const provider = makeOpenAIProvider({
        apiKey: Bun.env.OPENAI_API_KEY ?? "cassette-key",
        mode: "completions",
      });

      const response = yield* provider.call({
        modelId,
        messages: [LLM.user("Return exactly the text: pong")],
        params: { maxTokens: 16, temperature: 0 },
      });

      expect(response.providerId).toBe("openai");
      expect(response.modelId).toBe(modelId);
      expect(response.text.toLowerCase()).toContain("pong");
      expect(response.usage.tokens.input).toBeGreaterThan(0);
    }),
  { timeout: 30_000 },
);

streamCompletionsIt(
  "streams OpenAI Chat Completions API",
  () =>
    Effect.gen(function* () {
      const provider = makeOpenAIProvider({
        apiKey: Bun.env.OPENAI_API_KEY ?? "cassette-key",
        mode: "completions",
      });

      const chunks = yield* Stream.runCollect(
        provider.stream({
          modelId,
          messages: [LLM.user("Return exactly the text: pong")],
          params: { maxTokens: 16, temperature: 0 },
        }),
      );

      const all = Array.from(chunks);
      const text = all
        .filter((chunk): chunk is LLM.TextChunk => chunk.type === "text_chunk")
        .map((chunk) => chunk.delta)
        .join("");

      expect(text.toLowerCase()).toContain("pong");
      expect(all.some((chunk) => chunk.type === "usage_delta_chunk")).toBe(
        true,
      );
    }),
  { timeout: 30_000 },
);
