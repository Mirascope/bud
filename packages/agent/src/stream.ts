import { Compaction } from "./compaction.ts";
import type { AgentStreamEvent } from "./stream-events.ts";
import { System, systemPromptText } from "./system.ts";
import { Tools } from "./tools.ts";
import * as LLM from "@bud/llm";
import {
  Sessions,
  SessionError,
  type SessionId,
  type ThinkingLevel,
} from "@bud/sessions";
import { Effect, Queue, Stream } from "effect";

export interface AgentStreamConfig {
  readonly systemPrompt?: string;
  readonly tools?: readonly LLM.AnyTool[];
  readonly maxIterations?: number;
  readonly thinkingLevel?: ThinkingLevel | null;
  readonly modelId?: string;
  readonly autocompactBufferTokens?: number;
}

export function streamAgentTurn(
  config: AgentStreamConfig,
  sessionId: SessionId,
  message: LLM.UserMessage,
  priorMessages: readonly LLM.Message[] = [],
): Effect.Effect<
  Stream.Stream<AgentStreamEvent>,
  SessionError,
  LLM.Model | LLM.ModelInfo | Sessions | System | Tools | Compaction
> {
  return Effect.gen(function* () {
    const maxIterations = config.maxIterations ?? 25;

    const model = yield* LLM.Model;
    const sessions = yield* Sessions;
    const system = yield* System;
    const tools = yield* Tools;
    const compaction = yield* Compaction;
    const systemPrompt = config.systemPrompt
      ? config.systemPrompt
      : systemPromptText(
          yield* system.prompt({
            sessionId,
            modelId: config.modelId,
            thinkingLevel: config.thinkingLevel,
          }),
        );
    const toolList = config.tools
      ? [...config.tools]
      : [...(yield* tools.tools)];
    const toolsArg = toolList.length > 0 ? toolList : undefined;
    const { loadMessages, compactIfNeeded } = yield* compaction.prepare({
      sessionId,
      systemPrompt,
      tools: toolsArg,
      autocompactBufferTokens: config.autocompactBufferTokens,
    });

    const queue = yield* Queue.unbounded<AgentStreamEvent>();
    const offer = (event: AgentStreamEvent) => Queue.offer(queue, event);

    const worker = Effect.gen(function* () {
      yield* offer({ type: "session", sessionId });

      const preDispatchCount =
        priorMessages.length > 0 ? (yield* loadMessages()).length : 0;
      const withPrior = (messages: LLM.Message[]): LLM.Message[] =>
        priorMessages.length === 0
          ? messages
          : [
              ...messages.slice(0, preDispatchCount),
              ...priorMessages,
              ...messages.slice(preDispatchCount),
            ];

      yield* sessions.addUserTurn(sessionId, message);

      let iterations = 0;
      let lastUsage: LLM.Usage | undefined;
      let capped = false;

      while (iterations < maxIterations) {
        const messages = withPrior(yield* loadMessages());

        const streamResponse = yield* model.stream({
          content: messages,
          tools: toolsArg,
          ...(config.thinkingLevel
            ? { thinking: { level: config.thinkingLevel } }
            : {}),
        });

        yield* Stream.runForEach(streamResponse.streams(), (contentStream) =>
          Effect.gen(function* () {
            switch (contentStream.type) {
              case "text":
                yield* Stream.runForEach(contentStream.deltas, (delta) =>
                  offer({ type: "text", delta }),
                );
                break;
              case "thought":
                yield* Stream.runForEach(contentStream.deltas, (delta) =>
                  offer({ type: "thought", delta }),
                );
                break;
              case "tool_call":
                yield* Stream.runDrain(contentStream.deltas);
                break;
            }
          }),
        );

        yield* sessions.addAssistantTurn(sessionId, streamResponse);
        lastUsage = streamResponse.usage;
        yield* compactIfNeeded(streamResponse.usage.tokens.input);

        if (streamResponse.tools.length === 0) break;

        for (const call of streamResponse.tools) {
          let parsedArgs: unknown;
          try {
            parsedArgs = JSON.parse(call.args);
          } catch {
            parsedArgs = { _rawArgs: call.args };
          }
          yield* offer({
            type: "tool_call",
            id: call.id,
            name: call.name,
            args: parsedArgs,
          });
        }

        const toolParts = yield* streamResponse.executeTools();
        yield* sessions.addUserTurn(sessionId, {
          role: "user",
          content: [...toolParts],
          name: null,
        });

        for (const part of toolParts) {
          if (part.type === "tool_output") {
            yield* offer({
              type: "tool_result",
              id: part.id,
              ok: !part.isError,
              output: part.result,
            });
          }
        }

        iterations++;
        if (iterations >= maxIterations) {
          capped = true;
        } else if (streamResponse.tools.length > 0) {
          yield* offer({ type: "turn_end" });
        }
      }

      yield* offer({
        type: "done",
        sessionId,
        capped,
        ...(config.modelId ? { modelId: config.modelId } : {}),
        ...(config.thinkingLevel !== undefined
          ? { thinkingLevel: config.thinkingLevel }
          : {}),
        usage: lastUsage ?? LLM.createUsage(),
      });
    }).pipe(
      Effect.catchAll((error) =>
        offer({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      Effect.ensuring(Queue.shutdown(queue)),
    );

    yield* Effect.forkDaemon(worker);

    return Stream.fromQueue(queue);
  });
}
