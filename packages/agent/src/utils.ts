import * as LLM from "@bud/llm";
import {
  Sessions,
  SessionError,
  estimateTokens,
  type SessionId,
} from "@bud/sessions";
import { Effect } from "effect";

export const DEFAULT_AUTOCOMPACT_BUFFER_TOKENS = 20_000;
const MAX_COMPACT_FAILURES = 3;

export interface AgentUtilsConfig {
  readonly sessionId: SessionId;
  readonly systemPrompt: string;
  readonly tools?: readonly LLM.AnyTool[];
  readonly autocompactBufferTokens?: number;
}

export interface AgentUtilsService {
  readonly loadMessages: () => Effect.Effect<
    LLM.Message[],
    SessionError,
    LLM.Model
  >;
  readonly compactIfNeeded: (
    tokens: number,
  ) => Effect.Effect<boolean, SessionError, LLM.Model>;
  readonly retryOnOverflow: <R>(
    effect: Effect.Effect<LLM.Response, LLM.ProviderError, R>,
  ) => Effect.Effect<
    LLM.Response,
    LLM.ProviderError | SessionError,
    R | LLM.Model
  >;
}

export const AgentUtils = {
  make: (
    config: AgentUtilsConfig,
  ): Effect.Effect<
    AgentUtilsService,
    never,
    LLM.Model | LLM.ModelInfo | Sessions
  > =>
    Effect.gen(function* () {
      const model = yield* LLM.Model;
      const modelInfo = yield* LLM.ModelInfo;
      const sessions = yield* Sessions;
      const contextWindowTokens = modelInfo.get(
        model.modelId,
      ).contextWindowTokens;
      const compactThreshold = Math.max(
        1,
        contextWindowTokens -
          (config.autocompactBufferTokens ?? DEFAULT_AUTOCOMPACT_BUFFER_TOKENS),
      );
      const compactOpts = {
        contextWindowTokens,
        systemPrompt: config.systemPrompt,
      };
      const toolsArg = config.tools?.length ? config.tools : undefined;
      let compactFailures = 0;

      const getMessages = () =>
        sessions.messages(config.sessionId, {
          systemPrompt: config.systemPrompt,
        });

      const compactIfNeeded = (tokens: number) => {
        if (
          tokens <= compactThreshold ||
          compactFailures >= MAX_COMPACT_FAILURES
        ) {
          return Effect.succeed(false);
        }

        return sessions.compact(config.sessionId, compactOpts).pipe(
          Effect.map(() => true),
          Effect.catchAll(() => {
            compactFailures++;
            return Effect.succeed(false);
          }),
        );
      };

      const loadMessages = () =>
        Effect.gen(function* () {
          const messages = yield* getMessages();
          const compacted = yield* compactIfNeeded(estimateTokens(messages));
          return compacted ? yield* getMessages() : messages;
        });

      const retryOnOverflow = <R>(
        effect: Effect.Effect<LLM.Response, LLM.ProviderError, R>,
      ) =>
        effect.pipe(
          Effect.catchIf(
            (error) => error.kind === "context_overflow",
            () =>
              sessions
                .compact(config.sessionId, compactOpts)
                .pipe(
                  Effect.flatMap((messages) =>
                    model.call({ content: messages, tools: toolsArg }),
                  ),
                ),
          ),
        );

      return { loadMessages, compactIfNeeded, retryOnOverflow };
    }),
};
