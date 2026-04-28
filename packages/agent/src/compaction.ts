import {
  AgentUtils,
  type AgentUtilsConfig,
  type AgentUtilsService,
} from "./utils.ts";
import * as LLM from "@bud/llm";
import { Sessions } from "@bud/sessions";
import { Context, Effect, Layer } from "effect";

export interface CompactionService {
  readonly prepare: (
    config: AgentUtilsConfig,
  ) => Effect.Effect<
    AgentUtilsService,
    never,
    LLM.Model | LLM.ModelInfo | Sessions
  >;
}

export class Compaction extends Context.Tag("@bud/agent/Compaction")<
  Compaction,
  CompactionService
>() {
  static default(): Layer.Layer<Compaction> {
    return Layer.succeed(Compaction, {
      prepare: AgentUtils.make,
    });
  }
}
