import { Bud, type BudConfig } from "./bud.ts";
import { Cron } from "./cron.ts";
import { Identity } from "./identity.ts";
import { Journal } from "./journal.ts";
import {
  WebContainerComputer,
  type WebContainerComputerOptions,
} from "@bud/computer";
import * as LLM from "@bud/llm";
import { IndexedDB, type IndexedDBOptions } from "@bud/object-storage";
import {
  SessionsLocalStorage,
  type SessionsLocalStorageOptions,
} from "@bud/sessions";
import { Layer } from "effect";

export interface BrowserBudOptions
  extends Partial<
    Pick<
      BudConfig,
      | "systemPrompt"
      | "modelId"
      | "tools"
      | "includeComputerTool"
      | "includeDomainTools"
      | "maxIterations"
      | "thinkingLevel"
      | "autocompactBufferTokens"
    >
  > {
  readonly webLLM?: LLM.WebLLMProviderOptions;
  readonly webLLMProvider?: LLM.WebLLMProviderService;
  readonly anthropic?: LLM.AnthropicProviderOptions;
  readonly anthropicProvider?: LLM.ProviderService;
  readonly openAI?: LLM.OpenAIProviderOptions;
  readonly openAIProvider?: LLM.ProviderService;
  readonly google?: LLM.GoogleProviderOptions;
  readonly googleProvider?: LLM.ProviderService;
  readonly computer?: WebContainerComputerOptions;
  readonly objectStorage?: IndexedDBOptions;
  readonly sessions?: SessionsLocalStorageOptions;
  readonly modelParams?: LLM.Params;
}

export const DEFAULT_BROWSER_BUD_SYSTEM_PROMPT =
  "You are Bud, a helpful browser-native coding assistant. Use the computer tool when you need to inspect, create, edit, or run files in the workspace.";

export const BrowserBud = {
  layer: (options: BrowserBudOptions = {}): Layer.Layer<Bud> => {
    const modelId =
      options.modelId ?? `web-llm/${LLM.WEB_LLM_DEFAULT_MODEL_ID}`;
    const provider =
      options.webLLMProvider ?? LLM.makeWebLLMProvider(options.webLLM);
    const providerEntries: LLM.ProviderEntry[] = [
      { scopes: ["web-llm/", "local", "hermes-3"], provider },
    ];
    if (options.anthropicProvider) {
      providerEntries.push({
        scopes: "anthropic/",
        provider: options.anthropicProvider,
      });
    } else if (options.anthropic?.apiKey) {
      providerEntries.push({
        scopes: "anthropic/",
        provider: LLM.makeAnthropicProvider(options.anthropic),
      });
    }
    if (options.openAIProvider) {
      providerEntries.push({
        scopes: "openai/",
        provider: options.openAIProvider,
      });
    } else if (options.openAI?.apiKey) {
      providerEntries.push({
        scopes: "openai/",
        provider: LLM.makeOpenAIProvider(options.openAI),
      });
    }
    if (options.googleProvider) {
      providerEntries.push({
        scopes: "google/",
        provider: options.googleProvider,
      });
    } else if (options.google?.apiKey) {
      providerEntries.push({
        scopes: "google/",
        provider: LLM.makeGoogleProvider(options.google),
      });
    }
    const providerRegistry = LLM.ProviderRegistry.layer(providerEntries);

    const storage = IndexedDB.layer(options.objectStorage);
    const sessions = SessionsLocalStorage(options.sessions).pipe(
      Layer.provide(storage),
    );
    const model = LLM.Model.layerWithDefaultPricing({
      modelId,
      params: options.modelParams,
    }).pipe(Layer.provide(providerRegistry));

    const dependencies = Layer.mergeAll(
      WebContainerComputer.layer(options.computer),
      Identity.memory(),
      Journal.memory(),
      Cron.memory(),
      sessions,
      model,
      LLM.ModelInfoDefault,
    );

    return Bud.layer({
      systemPrompt: options.systemPrompt ?? DEFAULT_BROWSER_BUD_SYSTEM_PROMPT,
      modelId,
      tools: options.tools,
      includeComputerTool: options.includeComputerTool,
      includeDomainTools: options.includeDomainTools,
      maxIterations: options.maxIterations,
      thinkingLevel: options.thinkingLevel,
      autocompactBufferTokens: options.autocompactBufferTokens,
    }).pipe(Layer.provide(dependencies));
  },
};
