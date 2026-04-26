import { AgentUtils } from "./utils.ts";
import * as LLM from "@bud/llm";
import {
  Sessions,
  SessionError,
  totalInputTokens,
  type SessionId,
  type SessionsService,
} from "@bud/sessions";
import { Effect } from "effect";

export interface AgentConfig {
  readonly systemPrompt: string;
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
    LLM.Model | LLM.ModelInfo | Sessions
  >;

  readonly resume: (
    sessionId: SessionId,
  ) => Effect.Effect<
    LLM.Response,
    LLM.ProviderError | SessionError,
    LLM.Model | LLM.ModelInfo | Sessions
  >;
}

export const Agent = {
  make: (config: AgentConfig): AgentService => {
    const maxIterations = config.maxIterations ?? 25;
    const tools = config.tools ?? [];
    const toolsArg = tools.length > 0 ? tools : undefined;

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
          const { loadMessages, compactIfNeeded, retryOnOverflow } =
            yield* AgentUtils.make({
              sessionId,
              systemPrompt: config.systemPrompt,
              tools: toolsArg,
              autocompactBufferTokens: config.autocompactBufferTokens,
            });

          yield* sessions.addUserTurn(sessionId, message);
          const messages = yield* loadMessages();

          const response = yield* model
            .call({ content: messages, tools: toolsArg })
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
          const { loadMessages, compactIfNeeded, retryOnOverflow } =
            yield* AgentUtils.make({
              sessionId,
              systemPrompt: config.systemPrompt,
              tools: toolsArg,
              autocompactBufferTokens: config.autocompactBufferTokens,
            });

          const messages = yield* loadMessages();

          const response = yield* model
            .call({ content: messages, tools: toolsArg })
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
