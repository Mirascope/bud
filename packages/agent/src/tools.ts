import * as LLM from "@bud/llm";
import { Context, Effect, Layer } from "effect";

export interface ToolsService {
  readonly tools: Effect.Effect<readonly LLM.AnyTool[]>;
}

export class Tools extends Context.Tag("@bud/agent/Tools")<
  Tools,
  ToolsService
>() {
  static fromArray(tools: readonly LLM.AnyTool[] = []): Layer.Layer<Tools> {
    return Layer.succeed(Tools, {
      tools: Effect.succeed([...tools]),
    });
  }
}
