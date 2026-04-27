import type { PromptSnapshot } from "./sessions.schemas.ts";
import type { CryptoService } from "@bud/crypto";
import { Effect } from "effect";

type ToolInput = {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
};

export function normalize(
  systemPrompt: string,
  tools: readonly ToolInput[],
): PromptSnapshot {
  const sortedTools = [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { systemPrompt, tools: sortedTools };
}

export function hashPromptSnapshot(
  snapshot: PromptSnapshot,
  crypto: CryptoService,
) {
  return crypto.sha256Hex(JSON.stringify(snapshot)).pipe(Effect.orDie);
}
