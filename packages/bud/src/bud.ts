import {
  Agent,
  computerTool,
  streamAgentTurn,
  type AgentStreamEvent,
} from "@bud/agent";
import { Computer, type ComputerService } from "@bud/computer";
import * as LLM from "@bud/llm";
import {
  Sessions,
  SessionError,
  type SessionHeader,
  type SessionId,
  type SessionsService,
  type ThinkingLevel,
} from "@bud/sessions";
import { Context, Effect, Layer, Stream } from "effect";

export interface BudConfig {
  readonly systemPrompt: string;
  readonly modelId: string;
  readonly tools?: readonly LLM.AnyTool[];
  readonly includeComputerTool?: boolean;
  readonly maxIterations?: number;
  readonly thinkingLevel?: ThinkingLevel | null;
  readonly autocompactBufferTokens?: number;
}

export interface BudCreateSessionOptions {
  readonly sessionId?: SessionId;
  readonly modelId?: string;
  readonly forkFromSessionId?: SessionId;
  readonly thinkingLevel?: ThinkingLevel | null;
}

export interface BudPromptOptions {
  readonly sessionId: SessionId;
  readonly message: string | LLM.UserMessage;
  readonly modelId?: string;
  readonly thinkingLevel?: ThinkingLevel | null;
}

export interface BudStreamOptions extends BudPromptOptions {
  readonly priorMessages?: readonly LLM.Message[];
}

export interface BudService {
  readonly config: BudConfig;
  readonly sessions: SessionsService;
  readonly computer: ComputerService;
  readonly createSession: (
    options?: BudCreateSessionOptions,
  ) => Effect.Effect<SessionHeader, SessionError>;
  readonly prompt: (
    options: BudPromptOptions,
  ) => Effect.Effect<LLM.Response, LLM.ProviderError | SessionError>;
  readonly stream: (
    options: BudStreamOptions,
  ) => Effect.Effect<Stream.Stream<AgentStreamEvent>, SessionError>;
}

export class Bud extends Context.Tag("@bud/bud/Bud")<Bud, BudService>() {
  static layer(
    config: BudConfig,
  ): Layer.Layer<Bud, never, Computer | LLM.Model | LLM.ModelInfo | Sessions> {
    return Layer.effect(
      Bud,
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        const computer = yield* Computer;
        const model = yield* LLM.Model;
        const modelInfo = yield* LLM.ModelInfo;
        const tools =
          (config.includeComputerTool ?? true)
            ? [...(config.tools ?? []), computerTool]
            : [...(config.tools ?? [])];

        const agentConfig = {
          systemPrompt: config.systemPrompt,
          tools,
          maxIterations: config.maxIterations,
          autocompactBufferTokens: config.autocompactBufferTokens,
        };
        const agent = Agent.make(agentConfig);

        const provideRuntime = <A, E, R>(
          effect: Effect.Effect<A, E, R>,
        ): Effect.Effect<
          A,
          E,
          Exclude<R, Computer | LLM.Model | LLM.ModelInfo | Sessions>
        > =>
          effect.pipe(
            Effect.provideService(Sessions, sessions),
            Effect.provideService(Computer, computer),
            Effect.provideService(LLM.ModelInfo, modelInfo),
            Effect.provideService(LLM.Model, model),
          ) as Effect.Effect<
            A,
            E,
            Exclude<R, Computer | LLM.Model | LLM.ModelInfo | Sessions>
          >;

        const toUserMessage = (
          message: string | LLM.UserMessage,
        ): LLM.UserMessage =>
          typeof message === "string" ? LLM.user(message) : message;

        const createSession = (options: BudCreateSessionOptions = {}) =>
          sessions
            .create({
              sessionId: options.sessionId ?? randomSessionId(),
              modelId: options.modelId ?? config.modelId,
              forkFromSessionId: options.forkFromSessionId,
            })
            .pipe(
              Effect.tap((header) =>
                sessions.updateModel(
                  header.sessionId,
                  options.modelId ?? config.modelId,
                  options.thinkingLevel ?? config.thinkingLevel,
                ),
              ),
            );

        const ensureSession = (
          sessionId: SessionId,
          modelId: string,
          thinkingLevel: ThinkingLevel | null | undefined,
        ) =>
          createSession({ sessionId, modelId, thinkingLevel }).pipe(
            Effect.asVoid,
          );

        return {
          config,
          sessions,
          computer,
          createSession,
          prompt: (options) => {
            const modelId = options.modelId ?? config.modelId;
            const thinkingLevel =
              options.thinkingLevel ?? config.thinkingLevel ?? null;
            return Effect.gen(function* () {
              yield* ensureSession(options.sessionId, modelId, thinkingLevel);
              return yield* provideRuntime(
                agent.prompt(options.sessionId, toUserMessage(options.message)),
              );
            });
          },
          stream: (options) => {
            const modelId = options.modelId ?? config.modelId;
            const thinkingLevel =
              options.thinkingLevel ?? config.thinkingLevel ?? null;
            return Effect.gen(function* () {
              yield* ensureSession(options.sessionId, modelId, thinkingLevel);
              return yield* provideRuntime(
                streamAgentTurn(
                  {
                    ...agentConfig,
                    modelId,
                    thinkingLevel,
                  },
                  options.sessionId,
                  toUserMessage(options.message),
                  options.priorMessages ?? [],
                ),
              );
            });
          },
        } satisfies BudService;
      }),
    );
  }
}

export function randomSessionId(): SessionId {
  return `bud:${crypto.randomUUID()}`;
}
