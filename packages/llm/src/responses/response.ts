import {
  AssistantContentPart,
  type UserContentPart,
} from "../content/index.ts";
import type { ToolCall } from "../content/tool-call.ts";
import {
  toolOutputSuccess,
  toolOutputFailure,
} from "../content/tool-output.ts";
import type { AssistantMessage, Message } from "../messages/message.ts";
import { ProviderError } from "../providers/provider.schemas.ts";
import type { AnyTool } from "../tools/define-tool.ts";
import type { ToolSchema } from "../tools/tool-schema.ts";
import { FinishReason } from "./finish-reason.ts";
import { UsageSchema, type Usage } from "./usage.ts";
import { Effect, Schema } from "effect";

// ---------------------------------------------------------------------------
// ResponseData — schema-derived base class
// ---------------------------------------------------------------------------

export class ResponseData extends Schema.Class<ResponseData>("ResponseData")({
  content: Schema.Array(AssistantContentPart),
  usage: UsageSchema,
  finishReason: FinishReason,
  providerId: Schema.String,
  modelId: Schema.String,
  providerModelName: Schema.String,
  rawMessage: Schema.Unknown,
}) {}

// ---------------------------------------------------------------------------
// ResponseInit
// ---------------------------------------------------------------------------

export interface ResponseInit {
  readonly content?: readonly (typeof AssistantContentPart.Type)[];
  readonly usage?: Usage;
  readonly finishReason?: typeof FinishReason.Type;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerModelName: string;
  readonly rawMessage?: unknown;
  readonly inputMessages: readonly Message[];
  readonly tools: readonly AnyTool[];
  readonly toolSchemas: readonly ToolSchema[];
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** Response from an LLM call. */
export class Response extends ResponseData {
  /** @internal */ _inputMessages: readonly Message[];
  /** @internal */ _tools: readonly AnyTool[];
  /** @internal */ _toolSchemas: readonly ToolSchema[];

  constructor(init: ResponseInit) {
    super({
      content: init.content ? [...init.content] : [],
      usage: init.usage ?? {
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          costCenticents: 0,
        },
        tools: [],
        costCenticents: 0,
      },
      finishReason: init.finishReason ?? "stop",
      providerId: init.providerId,
      modelId: init.modelId,
      providerModelName: init.providerModelName,
      rawMessage: init.rawMessage ?? null,
    });
    this._inputMessages = init.inputMessages;
    this._tools = init.tools;
    this._toolSchemas = init.toolSchemas;
  }

  get text(): string {
    return this.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  }

  get tools(): ToolCall[] {
    return this.content.filter((p): p is ToolCall => p.type === "tool_call");
  }

  /**
   * Execute tool calls against the tools from the original call.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeTools(): Effect.Effect<UserContentPart[], never, any> {
    const calls = this.tools;
    const toolMap = new Map(this._tools.map((t) => [t.name, t]));

    return Effect.gen(function* () {
      const parts: UserContentPart[] = [];

      for (const call of calls) {
        const tool = toolMap.get(call.name);
        if (!tool) {
          parts.push(
            toolOutputFailure(
              call.id,
              call.name,
              new Error(`Tool "${call.name}" not found`),
            ),
          );
          continue;
        }

        const args = yield* Effect.try({
          try: () => JSON.parse(call.args) as unknown,
          catch: () =>
            new Error(`Invalid JSON in tool args for "${call.name}"`),
        }).pipe(
          Effect.catchAll((err) => {
            parts.push(toolOutputFailure(call.id, call.name, err));
            return Effect.succeed(null);
          }),
        );
        if (args === null) continue;

        yield* tool.execute(args).pipe(
          Effect.tap((result) => {
            parts.push(
              toolOutputSuccess(
                call.id,
                call.name,
                result.result,
                result.usage,
              ),
            );
            if (result.content) {
              for (const part of result.content) parts.push(part);
            }
            return Effect.void;
          }),
          Effect.catchAll((error) => {
            parts.push(
              toolOutputFailure(
                call.id,
                call.name,
                error instanceof Error ? error : new Error(String(error)),
              ),
            );
            return Effect.void;
          }),
        );
      }

      return parts;
    });
  }

  protected _buildResumeMessages(parts: readonly UserContentPart[]): Message[] {
    const assistantMsg: AssistantMessage = {
      role: "assistant",
      content: [...this.content],
      name: null,
      providerId: this.providerId,
      modelId: this.modelId,
      providerModelName: this.providerModelName,
      rawMessage: this.rawMessage,
    };

    const toolResultMsg: Message = {
      role: "user",
      content: [...parts],
      name: null,
    };

    return [...this._inputMessages, assistantMsg, toolResultMsg];
  }

  /** Resume the conversation with tool results. */
  resume(
    parts: readonly UserContentPart[],
  ): Effect.Effect<Response, ProviderError, import("../model.ts").Model> {
    const messages = this._buildResumeMessages(parts);
    const tools = this._tools;

    return Effect.gen(function* () {
      const { Model } = yield* Effect.promise(() => import("../model.ts")).pipe(
        Effect.orDie,
      );
      const model = yield* Model;
      return yield* model.call({ content: messages, tools });
    });
  }
}
