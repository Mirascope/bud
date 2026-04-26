import type { UserContentPart } from "./content/index.ts";
import type { Message, UserMessage } from "./messages/message.ts";
import { PricingDefault } from "./pricing/default.ts";
import { Pricing, type PricingService } from "./pricing/pricing.ts";
import type { ProviderCallArgs } from "./providers/provider.schemas.ts";
import { ProviderError } from "./providers/provider.schemas.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import type { Params } from "./responses/params.ts";
import { Response } from "./responses/response.ts";
import { StreamResponse } from "./responses/stream-response.ts";
import type { AnyTool } from "./tools/define-tool.ts";
import type { ToolSchema } from "./tools/tool-schema.ts";
import { Context, Effect, Layer } from "effect";

// ---------------------------------------------------------------------------
// Model content
// ---------------------------------------------------------------------------

export type ModelContent =
  | string
  | readonly UserContentPart[]
  | readonly Message[];

// ---------------------------------------------------------------------------
// Content promotion helpers
// ---------------------------------------------------------------------------

function isMessageArray(content: ModelContent): content is readonly Message[] {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    typeof content[0] === "object" &&
    "role" in content[0]
  );
}

function promoteToMessages(content: ModelContent): readonly Message[] {
  if (typeof content === "string") {
    return [
      {
        role: "user",
        content: [{ type: "text", text: content }],
        name: null,
      } as UserMessage,
    ];
  }
  if (isMessageArray(content)) {
    return content;
  }
  return [
    {
      role: "user",
      content: content as readonly UserContentPart[],
      name: null,
    } as UserMessage,
  ];
}

function toolToSchema(tool: AnyTool): ToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict,
  };
}

interface BuiltProviderArgs {
  readonly providerArgs: ProviderCallArgs;
  readonly messages: readonly Message[];
  readonly tools: readonly AnyTool[];
  readonly toolSchemas: readonly ToolSchema[];
}

interface ResponseRuntimeContext {
  _inputMessages: readonly Message[];
  _tools: readonly AnyTool[];
  _toolSchemas: readonly ToolSchema[];
}

interface MutableUsageCost {
  costCenticents: number;
  tokens: {
    costCenticents: number;
  };
}

function attachResponseContext(
  response: Response,
  context: Omit<BuiltProviderArgs, "providerArgs">,
): void {
  const mutableResponse = response as Response & ResponseRuntimeContext;
  mutableResponse._inputMessages = context.messages;
  mutableResponse._tools = context.tools;
  mutableResponse._toolSchemas = context.toolSchemas;
}

function applyResponsePricing(
  response: Response,
  pricing: PricingService,
  modelId: string,
): void {
  const totalCost = pricing.llmCost(
    response.usage.tokens,
    response.usage.tools,
    modelId,
  );
  const toolCost = response.usage.tools.reduce(
    (sum, tool) =>
      sum + pricing.toolCost(tool.type, tool.count, tool.durationSeconds),
    0,
  );

  const usage = response.usage as MutableUsageCost;
  usage.tokens.costCenticents = totalCost - toolCost;
  usage.costCenticents = totalCost;
}

// ---------------------------------------------------------------------------
// Model call/stream args
// ---------------------------------------------------------------------------

export interface ModelCallArgs extends Params {
  readonly content: ModelContent;
  readonly tools?: readonly AnyTool[];
}

export interface ModelStreamArgs extends Params {
  readonly content: ModelContent;
  readonly tools?: readonly AnyTool[];
}

// ---------------------------------------------------------------------------
// Model service
// ---------------------------------------------------------------------------

export interface ModelService {
  readonly modelId: string;
  readonly call: (
    args: ModelCallArgs,
  ) => Effect.Effect<Response, ProviderError>;
  readonly stream: (
    args: ModelStreamArgs,
  ) => Effect.Effect<StreamResponse, ProviderError>;
}

export interface ModelConfig {
  readonly modelId: string;
  readonly params?: Params;
}

export class Model extends Context.Tag("@bud/llm/Model")<
  Model,
  ModelService
>() {
  static layer(
    config: ModelConfig,
  ): Layer.Layer<Model, never, ProviderRegistry | Pricing> {
    return Layer.effect(
      Model,
      Effect.gen(function* () {
        const registry = yield* ProviderRegistry;
        const pricing = yield* Pricing;

        function buildProviderArgs(args: ModelCallArgs): BuiltProviderArgs {
          const messages = promoteToMessages(args.content);
          const tools = args.tools ?? [];
          const { content: _, tools: __, ...params } = args;
          const mergedParams: Params = { ...config.params, ...params };
          const toolSchemas = tools.map(toolToSchema);

          return {
            messages,
            tools,
            toolSchemas,
            providerArgs: {
              modelId: config.modelId,
              messages,
              tools: toolSchemas,
              params: mergedParams,
            },
          };
        }

        return {
          modelId: config.modelId,

          call: (args: ModelCallArgs) =>
            Effect.gen(function* () {
              const provider = yield* registry.resolve(config.modelId);
              const { providerArgs, messages, tools, toolSchemas } =
                buildProviderArgs(args);
              const response = yield* provider.call(providerArgs);

              attachResponseContext(response, { messages, tools, toolSchemas });
              applyResponsePricing(response, pricing, config.modelId);

              return response;
            }),

          stream: (args: ModelStreamArgs) =>
            Effect.gen(function* () {
              const provider = yield* registry.resolve(config.modelId);
              const { providerArgs, messages, tools, toolSchemas } =
                buildProviderArgs(args as ModelCallArgs);

              return new StreamResponse({
                stream: provider.stream(providerArgs),
                providerId: provider.id,
                modelId: config.modelId,
                providerModelName: config.modelId,
                inputMessages: [...messages],
                tools: [...tools],
                toolSchemas: [...toolSchemas],
                computeCost: (usage) =>
                  pricing.llmCost(usage.tokens, usage.tools, config.modelId),
              });
            }),
        } satisfies ModelService;
      }),
    );
  }

  static layerWithDefaultPricing(
    config: ModelConfig,
  ): Layer.Layer<Model, never, ProviderRegistry> {
    return Model.layer(config).pipe(Layer.provide(PricingDefault));
  }
}
