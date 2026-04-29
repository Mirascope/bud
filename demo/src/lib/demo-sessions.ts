import {
  getHostedProviderAvailability,
  type HostedProviderAvailability,
} from "./llm-proxy.ts";
import * as LLM from "@bud/llm";
import {
  type SessionHeader,
  type SessionId,
  type ThinkingLevel,
} from "@bud/sessions";
import {
  createSpiderGatewayClient,
  type SpiderGatewayClient,
} from "@mirascope/bud";
import { Effect } from "effect";

export interface DemoMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: string;
  readonly attachments?: readonly DemoAttachment[];
  readonly activities?: readonly DemoActivity[];
  readonly modelId?: string;
  readonly thinkingLevel?: ThinkingLevel | null;
  readonly isComplete?: boolean;
  readonly isError?: boolean;
  readonly isPending?: boolean;
}

export interface DemoAttachment {
  readonly id: string;
  readonly name: string;
  readonly kind: "image" | "audio" | "video" | "document" | "file";
  readonly mimeType: string;
  readonly size?: number;
  readonly url?: string;
}

export interface DemoSession {
  readonly sessionId: SessionId;
  readonly title: string;
  readonly lastActiveAt: string;
}

export type DemoActivity =
  | {
      readonly id: string;
      readonly type: "thinking";
      readonly status: "active" | "done" | "error";
      readonly title: string;
      readonly content: string;
      readonly position?: "before_text" | "after_text";
    }
  | {
      readonly id: string;
      readonly type: "tool";
      readonly status: "active" | "done" | "error";
      readonly title: string;
      readonly position?: "before_text" | "after_text";
      readonly input?: unknown;
      readonly output?: unknown;
    };

export type DemoActivityEvent =
  | {
      readonly type: "thought";
      readonly delta: string;
      readonly position?: "before_text" | "after_text";
    }
  | {
      readonly type: "tool_call";
      readonly id: string;
      readonly name: string;
      readonly args: unknown;
      readonly position?: "before_text" | "after_text";
    }
  | {
      readonly type: "tool_result";
      readonly id: string;
      readonly ok: boolean;
      readonly output: unknown;
    };

const MODEL_ID = `web-llm/${LLM.WEB_LLM_DEFAULT_MODEL_ID}`;
const SETTINGS_KEY = "bud/demo/settings";

let webLLMProvider: LLM.WebLLMProviderService | null = null;
let spiderGateway: SpiderGatewayClient | null = null;
const progressListeners = new Set<(status: string) => void>();

export interface DemoProviderSecrets {
  readonly anthropic?: string;
  readonly openAI?: string;
  readonly google?: string;
}

export type DemoTheme = "light" | "dark" | "system";

export interface DemoSettings {
  readonly secrets: DemoProviderSecrets;
  readonly modelId: string;
  readonly thinkingLevel: ThinkingLevel | null;
  readonly theme: DemoTheme;
}

export interface DemoModelOption {
  readonly id: string;
  readonly label: string;
  readonly provider: "local" | "anthropic" | "openai" | "google";
  readonly supportsThinking: boolean;
}

export type DemoHostedProviderAvailability = HostedProviderAvailability;

export const DEMO_THINKING_LEVELS: readonly (ThinkingLevel | null)[] = [
  null,
  "minimal",
  "low",
  "medium",
  "high",
  "extra-high",
];

export const DEMO_LOCAL_MODELS: readonly DemoModelOption[] =
  LLM.WEB_LLM_FUNCTION_CALLING_MODEL_IDS.map((modelId) => ({
    id: `web-llm/${modelId}`,
    label: `${labelWebLLMModel(modelId)} local`,
    provider: "local" as const,
    supportsThinking: false,
  }));

export const DEMO_HOSTED_MODELS: readonly DemoModelOption[] = [
  {
    id: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    supportsThinking: true,
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    supportsThinking: true,
  },
  {
    id: "anthropic/claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    supportsThinking: true,
  },
  {
    id: "anthropic/claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "anthropic",
    supportsThinking: true,
  },
  {
    id: "openai/gpt-5.5:responses",
    label: "GPT-5.5",
    provider: "openai",
    supportsThinking: true,
  },
  {
    id: "openai/gpt-5.4:responses",
    label: "GPT-5.4",
    provider: "openai",
    supportsThinking: true,
  },
  {
    id: "openai/gpt-5.4-mini:responses",
    label: "GPT-5.4 mini",
    provider: "openai",
    supportsThinking: true,
  },
  {
    id: "openai/gpt-5.4-nano:responses",
    label: "GPT-5.4 nano",
    provider: "openai",
    supportsThinking: true,
  },
  {
    id: "openai/gpt-4.1-mini:responses",
    label: "GPT-4.1 mini",
    provider: "openai",
    supportsThinking: true,
  },
  {
    id: "google/gemini-3-pro-preview",
    label: "Gemini 3 Pro",
    provider: "google",
    supportsThinking: true,
  },
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    provider: "google",
    supportsThinking: true,
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    supportsThinking: true,
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    supportsThinking: true,
  },
];

export interface DemoModelPreparationStatus {
  readonly ready: boolean;
  readonly cached: boolean | null;
  readonly modelId: string;
}

export interface DemoModelPreparationProgress {
  readonly status: string;
  readonly progress: number | null;
}

export interface DemoModelRuntimeStatus {
  readonly browser: boolean;
  readonly crossOriginIsolated: boolean;
  readonly secureContext: boolean;
  readonly webGPU: boolean;
}

export function getDemoSettings(): DemoSettings {
  if (typeof window === "undefined") {
    return {
      secrets: {},
      modelId: MODEL_ID,
      thinkingLevel: null,
      theme: "system",
    };
  }

  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return {
      secrets: {},
      modelId: MODEL_ID,
      thinkingLevel: null,
      theme: "system",
    };
  }

  try {
    const normalized = normalizeDemoSettings(
      JSON.parse(raw) as Partial<DemoSettings>,
    );
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return {
      secrets: {},
      modelId: MODEL_ID,
      thinkingLevel: null,
      theme: "system",
    };
  }
}

export function saveDemoSettings(settings: DemoSettings): DemoSettings {
  const normalized = normalizeDemoSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function availableDemoModels(
  _settings: DemoSettings = getDemoSettings(),
  hostedAvailability?: DemoHostedProviderAvailability | null,
): readonly DemoModelOption[] {
  return [
    ...DEMO_LOCAL_MODELS,
    ...DEMO_HOSTED_MODELS.filter(
      (model) =>
        hostedAvailability?.[
          model.provider as keyof DemoHostedProviderAvailability
        ] === true,
    ),
  ];
}

function normalizeDemoSettings(settings: Partial<DemoSettings>): DemoSettings {
  const available = [...DEMO_LOCAL_MODELS, ...DEMO_HOSTED_MODELS];
  const modelId = available.some((model) => model.id === settings.modelId)
    ? settings.modelId!
    : MODEL_ID;
  const thinkingLevel = DEMO_THINKING_LEVELS.includes(
    settings.thinkingLevel ?? null,
  )
    ? (settings.thinkingLevel ?? null)
    : null;
  const theme =
    settings.theme === "light" ||
    settings.theme === "dark" ||
    settings.theme === "system"
      ? settings.theme
      : "system";

  return {
    secrets: {},
    modelId,
    thinkingLevel,
    theme,
  };
}

function localModelReadyKey(modelId: string): string {
  return `bud/demo/model-ready/${modelId}`;
}

function labelWebLLMModel(modelId: string): string {
  return modelId
    .replace("-MLC", "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\bq\d+f\d+\b/gi, "")
    .replace(/\b\d+\b/g, (part) => part)
    .replace(/\s+/g, " ")
    .trim()
    .replace("Hermes 3 Llama 3.1 8B", "Hermes 3 Llama 3.1 8B");
}

export async function loadDemoHostedProviderAvailability(): Promise<DemoHostedProviderAvailability> {
  return getHostedProviderAvailability();
}

export function getDemoModelPreparationStatus(
  modelId = getDemoSettings().modelId,
): DemoModelPreparationStatus {
  const ready =
    typeof window !== "undefined" &&
    typeof window.localStorage?.getItem === "function" &&
    window.localStorage.getItem(localModelReadyKey(modelId)) === "true";
  return {
    ready,
    cached: ready ? true : null,
    modelId,
  };
}

export function getDemoModelRuntimeStatus(): DemoModelRuntimeStatus {
  return {
    browser: typeof window !== "undefined",
    crossOriginIsolated:
      typeof window !== "undefined" && window.crossOriginIsolated,
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    webGPU: typeof navigator !== "undefined" && "gpu" in navigator,
  };
}

export async function refreshDemoModelPreparationStatus(
  modelId = getDemoSettings().modelId,
): Promise<DemoModelPreparationStatus> {
  const status = getDemoModelPreparationStatus(modelId);
  if (typeof window === "undefined") return status;

  const cached = await Effect.runPromise(
    getWebLLMProvider().hasCachedModel(modelId),
  );
  return {
    ...status,
    cached,
    ready: status.ready && cached,
  };
}

export async function prepareDemoModel(
  modelId = getDemoSettings().modelId,
  onProgress?: (progress: DemoModelPreparationProgress) => void,
): Promise<DemoModelPreparationStatus> {
  assertBrowserRuntimeSupport();

  const listener = (status: string) => {
    onProgress?.({
      status,
      progress: parseProgress(status),
    });
  };

  progressListeners.add(listener);
  try {
    listener(`Preparing ${modelLabel(modelId)}`);
    await Effect.runPromise(getWebLLMProvider().preload(modelId));
    window.localStorage.setItem(localModelReadyKey(modelId), "true");
    listener("Ready");
    return refreshDemoModelPreparationStatus(modelId);
  } catch (error) {
    window.localStorage.removeItem(localModelReadyKey(modelId));
    throw error;
  } finally {
    progressListeners.delete(listener);
  }
}

export async function resetDemoModelPreparation(
  modelId = getDemoSettings().modelId,
): Promise<DemoModelPreparationStatus> {
  assertBrowserStorageRuntime();

  await Effect.runPromise(getWebLLMProvider().deleteCachedModel(modelId));
  window.localStorage.removeItem(localModelReadyKey(modelId));
  return {
    ...getDemoModelPreparationStatus(modelId),
    cached: false,
  };
}

function modelLabel(modelId: string): string {
  return (
    [...DEMO_LOCAL_MODELS, ...DEMO_HOSTED_MODELS].find(
      (model) => model.id === modelId,
    )?.label ?? modelId
  );
}

function assertBrowserStorageRuntime(): void {
  if (typeof window === "undefined") {
    throw new Error("Bud can only update local model storage in the browser.");
  }
}

function assertBrowserRuntimeSupport(): void {
  assertBrowserStorageRuntime();
  const runtimeStatus = getDemoModelRuntimeStatus();
  if (!runtimeStatus.secureContext) {
    throw new Error(
      "Local model loading requires a secure browser context. Open Bud in a WebGPU-capable browser at http://localhost:4322/.",
    );
  }
  if (!runtimeStatus.crossOriginIsolated) {
    throw new Error(
      "Local model loading requires cross-origin isolation. The dev server is sending the required headers, but this browser context is not isolated.",
    );
  }
  if (!runtimeStatus.webGPU) {
    throw new Error("Local model loading requires a browser with WebGPU.");
  }
}

export async function listDemoSessions(): Promise<DemoSession[]> {
  return getSpiderGateway().call<DemoSession[]>("listSessions");
}

export async function ensureDemoSession(
  sessionId?: SessionId,
): Promise<SessionId> {
  if (sessionId) {
    await getSpiderGateway().call("openSession", { sessionId });
    return sessionId;
  }

  const existing = await listDemoSessions();
  const firstSession = existing[0]?.sessionId;
  if (firstSession) return firstSession;

  return createDemoSession();
}

export async function createDemoSession(): Promise<SessionId> {
  const settings = getDemoSettings();
  const header = await getSpiderGateway().call<SessionHeader>("createSession", {
    modelId: settings.modelId,
    thinkingLevel: settings.thinkingLevel,
  });
  return header.sessionId;
}

export async function deleteDemoSession(sessionId: SessionId): Promise<void> {
  await getSpiderGateway().call("deleteSession", { sessionId });
}

export async function loadDemoMessages(
  sessionId: SessionId,
): Promise<DemoMessage[]> {
  return getSpiderGateway().call<DemoMessage[]>("loadMessages", { sessionId });
}

export async function addDemoExchange(
  sessionId: SessionId,
  userText: string,
  attachments: readonly DemoAttachmentInput[] = [],
  options: {
    readonly modelId?: string;
    readonly thinkingLevel?: ThinkingLevel | null;
    readonly onAssistantDelta?: (delta: string) => void;
    readonly onActivity?: (activity: DemoActivityEvent) => void;
    readonly onStatus?: (status: string) => void;
    readonly onError?: (error: Error) => void;
    readonly onDone?: () => void;
  } = {},
): Promise<DemoMessage[]> {
  const progressListener =
    options.onStatus &&
    ((status: string) => {
      options.onStatus?.(status);
    });
  if (progressListener) progressListeners.add(progressListener);

  try {
    const settings = getDemoSettings();
    const modelId = options.modelId ?? settings.modelId;
    const thinkingLevel = options.thinkingLevel ?? settings.thinkingLevel;
    return await getSpiderGateway().stream<DemoMessage[]>(
      "addExchange",
      {
        sessionId,
        modelId,
        thinkingLevel,
        userText,
        attachments,
      },
      (rawEvent) => {
        const event = rawEvent as
          | { readonly type: "status"; readonly status: string }
          | { readonly type: string; readonly [key: string]: unknown };
        if (event.type === "status") {
          options.onStatus?.(event.status);
          return;
        }
        if (event.type === "error") {
          options.onError?.(new Error(String(event.message)));
          return;
        }

        switch (event.type) {
          case "text":
            options.onAssistantDelta?.(String(event.delta ?? ""));
            break;
          case "thought":
            options.onActivity?.({
              type: "thought",
              delta: String(event.delta ?? ""),
            });
            options.onStatus?.("Thinking");
            break;
          case "tool_call":
            options.onActivity?.({
              type: "tool_call",
              id: String(event.id),
              name: String(event.name),
              args: event.args,
            });
            options.onStatus?.(`Using ${String(event.name)}`);
            break;
          case "tool_result":
            options.onActivity?.({
              type: "tool_result",
              id: String(event.id),
              ok: event.ok === true,
              output: event.output,
            });
            options.onStatus?.("Reading tool result");
            break;
          case "done":
            options.onStatus?.("Done");
            options.onDone?.();
            break;
          default:
            break;
        }
      },
    );
  } finally {
    if (progressListener) progressListeners.delete(progressListener);
  }
}

export interface DemoAttachmentInput {
  readonly file: File;
}

function getSpiderGateway(): SpiderGatewayClient {
  spiderGateway ??= createSpiderGatewayClient(
    new URL("./demo-spider.worker.ts", import.meta.url),
    { name: "bud-demo-spider" },
  );
  return spiderGateway;
}

function getWebLLMProvider(): LLM.WebLLMProviderService {
  webLLMProvider ??= LLM.makeWebLLMProvider({
    engineConfig: {
      initProgressCallback: (report) => {
        const progress =
          report.progress > 0 ? ` ${Math.round(report.progress * 100)}%` : "";
        const status = report.text
          ? `${report.text}${progress}`
          : `Loading Hermes 3${progress}`;
        for (const listener of progressListeners) listener(status);
      },
    },
  });
  return webLLMProvider;
}

function parseProgress(status: string): number | null {
  const match = status.match(/(\d+)%/);
  if (!match) return null;
  return Math.min(100, Math.max(0, Number(match[1])));
}
