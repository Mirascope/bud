import * as LLM from "@bud/llm";
import type { SessionId, ThinkingLevel } from "@bud/sessions";
import { Context, Effect, Layer } from "effect";

export interface SystemContext {
  readonly sessionId: SessionId;
  readonly modelId?: string;
  readonly thinkingLevel?: ThinkingLevel | null;
}

export interface SystemService {
  readonly prompt: (
    context: SystemContext,
  ) => Effect.Effect<string | LLM.SystemMessage>;
}

export class System extends Context.Tag("@bud/agent/System")<
  System,
  SystemService
>() {
  static fromPrompt(prompt: string): Layer.Layer<System> {
    return Layer.succeed(System, {
      prompt: () => Effect.succeed(prompt),
    });
  }
}

export function systemPromptText(value: string | LLM.SystemMessage): string {
  return typeof value === "string" ? value : value.content.text;
}
