import * as LLM from "../index.ts";
import { createRecordIt, expect } from "@bud/testing";
import { Effect, Stream } from "effect";
import { existsSync } from "node:fs";
import { join } from "node:path";

const recordIt = createRecordIt(import.meta.dir, "anthropic");
const modelId = Bun.env.ANTHROPIC_TEST_MODEL ?? "anthropic/claude-haiku-4-5";

function canRun(cassetteName: string): boolean {
  return (
    Boolean(Bun.env.ANTHROPIC_API_KEY) ||
    existsSync(join(import.meta.dir, "cassettes", "anthropic", cassetteName))
  );
}

const callIt = canRun("calls-anthropic-messages-api.har")
  ? recordIt
  : recordIt.skip;
const streamIt = canRun("streams-anthropic-messages-api.har")
  ? recordIt
  : recordIt.skip;

callIt(
  "calls Anthropic Messages API",
  () =>
    Effect.gen(function* () {
      const provider = LLM.makeAnthropicProvider({
        apiKey: Bun.env.ANTHROPIC_API_KEY ?? "cassette-key",
      });

      const response = yield* provider.call({
        modelId,
        messages: [LLM.user("Return exactly the text: pong")],
        params: { maxTokens: 16, temperature: 0 },
      });

      expect(response.providerId).toBe("anthropic");
      expect(response.modelId).toBe(modelId);
      expect(response.text.toLowerCase()).toContain("pong");
      expect(response.usage.tokens.input).toBeGreaterThan(0);
    }),
  { timeout: 30_000 },
);

streamIt(
  "streams Anthropic Messages API",
  () =>
    Effect.gen(function* () {
      const provider = LLM.makeAnthropicProvider({
        apiKey: Bun.env.ANTHROPIC_API_KEY ?? "cassette-key",
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
