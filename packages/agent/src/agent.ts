import { Compaction } from "./compaction.ts";
import { System, systemPromptText } from "./system.ts";
import * as LLM from "@bud/llm";
import {
  Sessions,
  SessionError,
  totalInputTokens,
  type SessionId,
  type SessionsService,
} from "@bud/sessions";
import { Tools } from "@bud/tools";
import { Effect } from "effect";

export interface AgentConfig {
  readonly systemPrompt?: string;
  readonly tools?: readonly LLM.AnyTool[];
  readonly maxIterations?: number;
  readonly autocompactBufferTokens?: number;
}

export interface AgentService {
  readonly prompt: (
    sessionId: SessionId,
    message: LLM.UserMessage,
  ) => Effect.Effect<
    LLM.Response,
    LLM.ProviderError | SessionError,
    LLM.Model | LLM.ModelInfo | Sessions | System | Tools | Compaction
  >;

  readonly resume: (
    sessionId: SessionId,
  ) => Effect.Effect<
    LLM.Response,
    LLM.ProviderError | SessionError,
    LLM.Model | LLM.ModelInfo | Sessions | System | Tools | Compaction
  >;
}

export const Agent = {
  make: (config: AgentConfig): AgentService => {
    const maxIterations = config.maxIterations ?? 25;

    const resolveRuntime = (sessionId: SessionId) =>
      Effect.gen(function* () {
        const system = yield* System;
        const tools = yield* Tools;
        const compaction = yield* Compaction;
        const prompt = config.systemPrompt
          ? config.systemPrompt
          : systemPromptText(yield* system.prompt({ sessionId }));
        const toolList = config.tools
          ? [...config.tools]
          : [...(yield* tools.tools)];
        return {
          systemPrompt: prompt,
          tools: toolList,
          toolsArg: toolList.length > 0 ? toolList : undefined,
          compaction,
        };
      });

    const runToolLoop = (
      sessionId: SessionId,
      initialResponse: LLM.Response,
      sessions: SessionsService,
      compactIfNeeded: (
        tokens: number,
      ) => Effect.Effect<boolean, SessionError, LLM.Model>,
      retryOnOverflow: <R>(
        effect: Effect.Effect<LLM.Response, LLM.ProviderError, R>,
      ) => Effect.Effect<
        LLM.Response,
        LLM.ProviderError | SessionError,
        R | LLM.Model
      >,
    ) =>
      Effect.gen(function* () {
        let response = initialResponse;
        let iterations = 0;

        while (response.tools.length > 0 && iterations < maxIterations) {
          const parts = yield* response.executeTools();
          yield* sessions.addUserTurn(sessionId, {
            role: "user",
            content: [...parts],
            name: null,
          });

          response = yield* response.resume(parts).pipe(retryOnOverflow);
          yield* sessions.addAssistantTurn(sessionId, response);

          yield* compactIfNeeded(totalInputTokens(response));

          iterations++;
        }

        if (response.tools.length > 0) {
          const parts = yield* response.executeTools();
          yield* sessions.addUserTurn(sessionId, {
            role: "user",
            content: [...parts],
            name: null,
          });
        }

        return response;
      });

    return {
      prompt: (sessionId, message) =>
        Effect.gen(function* () {
          const model = yield* LLM.Model;
          const sessions = yield* Sessions;
          const runtime = yield* resolveRuntime(sessionId);
          const { loadMessages, compactIfNeeded, retryOnOverflow } =
            yield* runtime.compaction.prepare({
              sessionId,
              systemPrompt: runtime.systemPrompt,
              tools: runtime.toolsArg,
              autocompactBufferTokens: config.autocompactBufferTokens,
            });

          yield* sessions.addUserTurn(sessionId, message);
          const messages = yield* loadMessages();

          const response = yield* model
            .call({ content: messages, tools: runtime.toolsArg })
            .pipe(retryOnOverflow);
          yield* sessions.addAssistantTurn(sessionId, response);

          return yield* runToolLoop(
            sessionId,
            response,
            sessions,
            compactIfNeeded,
            retryOnOverflow,
          );
        }),

      resume: (sessionId) =>
        Effect.gen(function* () {
          const model = yield* LLM.Model;
          const sessions = yield* Sessions;
          const runtime = yield* resolveRuntime(sessionId);
          const { loadMessages, compactIfNeeded, retryOnOverflow } =
            yield* runtime.compaction.prepare({
              sessionId,
              systemPrompt: runtime.systemPrompt,
              tools: runtime.toolsArg,
              autocompactBufferTokens: config.autocompactBufferTokens,
            });

          const messages = yield* loadMessages();

          const response = yield* model
            .call({ content: messages, tools: runtime.toolsArg })
            .pipe(retryOnOverflow);
          yield* sessions.addAssistantTurn(sessionId, response);

          return yield* runToolLoop(
            sessionId,
            response,
            sessions,
            compactIfNeeded,
            retryOnOverflow,
          );
        }),
    };
  },
};
