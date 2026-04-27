import * as LLM from "../index.ts";
import {
  buildGoogleRequestBody,
  makeGoogleProvider,
} from "./provider.google.ts";
import { createRecordIt, expect, it } from "@bud/testing";
import { Effect, Stream } from "effect";
import { existsSync } from "node:fs";
import { join } from "node:path";

const recordIt = createRecordIt(import.meta.dir, "google");
const modelId = Bun.env.GOOGLE_TEST_MODEL ?? "google/gemini-2.5-flash";

function canRun(cassetteName: string): boolean {
  return (
    Boolean(Bun.env.GOOGLE_API_KEY) ||
    existsSync(join(import.meta.dir, "cassettes", "google", cassetteName))
  );
}

const callIt = canRun("calls-google-generatecontent-api.har")
  ? recordIt
  : recordIt.skip;
const streamIt = canRun("streams-google-generatecontent-api.har")
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

it("builds Google request bodies", () => {
  const body = buildGoogleRequestBody({
    modelId: "google/gemini-2.5-flash",
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
  "contents": [
    {
      "parts": [
        {
          "text": "Find it",
        },
      ],
      "role": "user",
    },
    {
      "parts": [
        {
          "functionCall": {
            "args": {},
            "id": "call_1",
            "name": "lookup",
          },
        },
      ],
      "role": "model",
    },
    {
      "parts": [
        {
          "functionResponse": {
            "id": "call_1",
            "name": "lookup",
            "response": {
              "output": "found",
            },
          },
        },
      ],
      "role": "user",
    },
  ],
  "generationConfig": {
    "maxOutputTokens": 32,
    "temperature": 0,
  },
  "systemInstruction": {
    "parts": [
      {
        "text": "You are terse.",
      },
    ],
  },
  "tools": [
    {
      "functionDeclarations": [
        {
          "description": "Look something up.",
          "name": "lookup",
          "parametersJsonSchema": {
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
      ],
    },
  ],
}
`);
});

it.effect("calls the Google GenerateContent API", () =>
  Effect.gen(function* () {
    let requestUrl = "";
    const provider = makeGoogleProvider({
      apiKey: "test-key",
      fetch: mockFetch(async (url) => {
        requestUrl = String(url);
        return jsonResponse({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "pong" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
          },
          modelVersion: "gemini-2.5-flash",
        });
      }),
    });

    const response = yield* provider.call({
      modelId: "google/gemini-2.5-flash",
      messages: [LLM.user("Return pong")],
    });

    expect(requestUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(response.text).toBe("pong");
    expect(response.usage.tokens.input).toBe(5);
  }),
);

it.effect("streams the Google GenerateContent API", () =>
  Effect.gen(function* () {
    const provider = makeGoogleProvider({
      apiKey: "test-key",
      fetch: mockFetch(async () =>
        sseResponse([
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "po" }],
                },
              },
            ],
          },
          {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "ng" }],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 5,
              candidatesTokenCount: 2,
            },
          },
        ]),
      ),
    });

    const chunks = yield* Stream.runCollect(
      provider.stream({
        modelId: "google/gemini-2.5-flash",
        messages: [LLM.user("Return pong")],
      }),
    );
    const all = Array.from(chunks);
    const text = all
      .filter((chunk): chunk is LLM.TextChunk => chunk.type === "text_chunk")
      .map((chunk) => chunk.delta)
      .join("");

    expect(text).toBe("pong");
    expect(all.some((chunk) => chunk.type === "usage_delta_chunk")).toBe(true);
  }),
);

callIt(
  "calls Google GenerateContent API",
  () =>
    Effect.gen(function* () {
      const provider = makeGoogleProvider({
        apiKey: Bun.env.GOOGLE_API_KEY ?? "cassette-key",
      });

      const response = yield* provider.call({
        modelId,
        messages: [LLM.user("Return exactly the text: pong")],
        params: { maxTokens: 16, temperature: 0 },
      });

      expect(response.providerId).toBe("google");
      expect(response.modelId).toBe(modelId);
      expect(response.text.toLowerCase()).toContain("pong");
      expect(response.usage.tokens.input).toBeGreaterThan(0);
    }),
  { timeout: 30_000 },
);

streamIt(
  "streams Google GenerateContent API",
  () =>
    Effect.gen(function* () {
      const provider = makeGoogleProvider({
        apiKey: Bun.env.GOOGLE_API_KEY ?? "cassette-key",
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
