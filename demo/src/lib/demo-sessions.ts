import {
  getHostedProviderAvailability,
  streamHostedProvider,
  type HostedProviderAvailability,
} from "./llm-proxy.ts";
import * as LLM from "@bud/llm";
import {
  type SessionHeader,
  type SessionId,
  type SessionSummary,
  type SessionsService,
  type ThinkingLevel,
} from "@bud/sessions";
import {
  BrowserBud,
  Bud,
  ProviderProxy,
  type BudService,
} from "@mirascope/bud";
import { Effect, Stream } from "effect";

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

const budPromises = new Map<string, Promise<BudService>>();
let webLLMProvider: LLM.WebLLMProviderService | null = null;
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
  budPromises.clear();
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
  const sessions = await getSessions();
  const summaries = await Effect.runPromise(sessions.summarize("bud"));
  return Promise.all(
    summaries.map(async (summary) => ({
      sessionId: summary.sessionId as SessionId,
      title: await titleForSession(summary),
      lastActiveAt: summary.lastActiveAt,
    })),
  );
}

export async function ensureDemoSession(
  sessionId?: SessionId,
): Promise<SessionId> {
  if (sessionId) {
    const sessions = await getSessions();
    await Effect.runPromise(sessions.open(sessionId));
    return sessionId;
  }

  const existing = await listDemoSessions();
  const firstSession = existing[0]?.sessionId;
  if (firstSession) return firstSession;

  return createDemoSession();
}

export async function createDemoSession(): Promise<SessionId> {
  const settings = getDemoSettings();
  const header = await createDemoSessionHeader(
    settings.modelId,
    settings.thinkingLevel,
  );
  return header.sessionId;
}

export async function deleteDemoSession(sessionId: SessionId): Promise<void> {
  const sessions = await getSessions();
  await Effect.runPromise(sessions.delete(sessionId));
}

export async function loadDemoMessages(
  sessionId: SessionId,
): Promise<DemoMessage[]> {
  const sessions = await getSessions();
  const [messages, turns] = await Promise.all([
    Effect.runPromise(sessions.messages(sessionId)),
    Effect.runPromise(sessions.turns(sessionId)),
  ]);
  const messageTurns = turns.filter(
    (turn) => turn.type === "user_turn" || turn.type === "assistant_turn",
  );

  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message, index) => {
      const turn = messageTurns[index];
      return {
        id: `${sessionId}-${index}`,
        role: message.role,
        content: textFromParts(message.content),
        timestamp: turn?.timestamp ?? new Date(0).toISOString(),
        attachments:
          message.role === "user"
            ? attachmentsFromParts(sessionId, message.content)
            : undefined,
        activities:
          message.role === "assistant"
            ? activitiesFromAssistantParts(
                `${sessionId}-${index}`,
                message.content,
              )
            : undefined,
        modelId:
          message.role === "assistant"
            ? (message.modelId ?? getDemoSettings().modelId)
            : undefined,
        thinkingLevel:
          message.role === "assistant"
            ? getDemoSettings().thinkingLevel
            : undefined,
        isComplete: message.role === "assistant" ? true : undefined,
      };
    })
    .filter((message) => {
      if (message.role !== "user") return true;
      return Boolean(message.content || (message.attachments?.length ?? 0) > 0);
    });
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

  const content: LLM.UserContentPart[] = userText
    ? [{ type: "text", text: userText }]
    : [];
  try {
    content.push(...(await attachmentsToContentParts(attachments)));

    const settings = getDemoSettings();
    const modelId = options.modelId ?? settings.modelId;
    const thinkingLevel = options.thinkingLevel ?? settings.thinkingLevel;
    const bud = await getBud(modelId);
    const stream = await Effect.runPromise(
      bud.stream({
        sessionId,
        modelId,
        thinkingLevel,
        message: LLM.user(content),
      }),
    );

    await Effect.runPromise(
      Stream.runForEach(stream, (event) => {
        if (event.type === "error")
          return Effect.fail(new Error(event.message));

        return Effect.sync(() => {
          switch (event.type) {
            case "session":
            case "turn_end":
              break;
            case "text":
              options.onAssistantDelta?.(event.delta);
              break;
            case "thought":
              options.onActivity?.({ type: "thought", delta: event.delta });
              options.onStatus?.("Thinking");
              break;
            case "tool_call":
              options.onActivity?.({
                type: "tool_call",
                id: event.id,
                name: event.name,
                args: event.args,
              });
              options.onStatus?.(`Using ${event.name}`);
              break;
            case "tool_result":
              options.onActivity?.({
                type: "tool_result",
                id: event.id,
                ok: event.ok,
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
        });
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            options.onError?.(
              error instanceof Error ? error : new Error(String(error)),
            );
          }).pipe(Effect.zipRight(Effect.fail(error))),
        ),
      ),
    );

    return loadDemoMessages(sessionId);
  } finally {
    if (progressListener) progressListeners.delete(progressListener);
  }
}

export interface DemoAttachmentInput {
  readonly file: File;
}

async function createDemoSessionHeader(
  modelId: string,
  thinkingLevel: ThinkingLevel | null,
): Promise<SessionHeader> {
  const bud = await getBud(modelId);
  return Effect.runPromise(bud.createSession({ modelId, thinkingLevel }));
}

async function getSessions(): Promise<SessionsService> {
  const bud = await getBud(getDemoSettings().modelId);
  return bud.sessions;
}

function getBud(modelId = getDemoSettings().modelId): Promise<BudService> {
  const cacheKey = JSON.stringify({ modelId });
  const cached = budPromises.get(cacheKey);
  if (cached) return cached;

  const promise = Effect.runPromise(
    Effect.gen(function* () {
      return yield* Bud;
    }).pipe(
      Effect.provide(
        BrowserBud.layer({
          modelId,
          objectStorage: {
            databaseName: "bud-demo",
            keyPrefix: "demo",
          },
          sessions: { namespace: "bud/demo/sessions" },
          modelParams: {
            maxTokens: 768,
            temperature: 0.2,
          },
          webLLMProvider: getWebLLMProvider(),
          anthropicProvider: ProviderProxy.make({
            id: "anthropic",
            stream: (args) =>
              streamHostedProvider({
                data: { provider: "anthropic", args },
              }),
          }),
          openAIProvider: ProviderProxy.make({
            id: "openai",
            stream: (args) =>
              streamHostedProvider({
                data: { provider: "openai", args },
              }),
          }),
          googleProvider: ProviderProxy.make({
            id: "google",
            stream: (args) =>
              streamHostedProvider({
                data: { provider: "google", args },
              }),
          }),
        }),
      ),
    ),
  );
  budPromises.set(cacheKey, promise);
  return promise;
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

async function titleForSession(summary: SessionSummary): Promise<string> {
  const sessions = await getSessions();
  const messages = await Effect.runPromise(
    sessions.messages(summary.sessionId as SessionId),
  );
  const firstUserText = messages
    .filter((message) => message.role === "user")
    .map((message) => textFromParts(message.content))
    .find((text) => text.trim().length > 0);
  if (!firstUserText) return "New chat";
  return firstUserText.length > 40
    ? `${firstUserText.slice(0, 40).trim()}...`
    : firstUserText;
}

function textFromParts(
  parts: LLM.Text | readonly (LLM.UserContentPart | LLM.AssistantContentPart)[],
): string {
  const normalized = Array.isArray(parts) ? parts : [parts];
  return normalized
    .filter((part): part is LLM.Text => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function activitiesFromAssistantParts(
  idPrefix: string,
  parts: LLM.Text | readonly (LLM.UserContentPart | LLM.AssistantContentPart)[],
): readonly DemoActivity[] {
  const normalized = Array.isArray(parts) ? parts : [parts];
  const activities: DemoActivity[] = [];

  for (const [index, part] of normalized.entries()) {
    if (part.type === "thought") {
      activities.push({
        id: `${idPrefix}-thought-${index}`,
        type: "thinking",
        status: "done",
        title: "Thinking",
        content: part.thought,
        position: "before_text",
      });
    }

    if (part.type === "tool_call") {
      activities.push({
        id: part.id || `${idPrefix}-tool-${index}`,
        type: "tool",
        status: "done",
        title: activityTitle(part.name),
        input: parseToolArgs(part.args),
        position: "before_text",
      });
    }
  }

  return activities;
}

function parseToolArgs(args: string): unknown {
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

function activityTitle(name: string): string {
  if (name === "computer") return "Computer";
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function attachmentsFromParts(
  sessionId: SessionId,
  parts: LLM.Text | readonly (LLM.UserContentPart | LLM.AssistantContentPart)[],
): readonly DemoAttachment[] {
  const normalized = Array.isArray(parts) ? parts : [parts];
  return normalized.flatMap((part, index): DemoAttachment[] => {
    if (part.type === "image") {
      const source = part.source;
      const mimeType =
        "mimeType" in source ? source.mimeType : "application/octet-stream";
      return [
        {
          id: `${sessionId}-attachment-${index}`,
          name: `Image ${index + 1}`,
          kind: "image",
          mimeType,
          url:
            source.type === "base64_image_source"
              ? `data:${source.mimeType};base64,${source.data}`
              : source.type === "url_image_source"
                ? source.url
                : undefined,
        },
      ];
    }

    if (part.type === "audio") {
      const source = part.source;
      return [
        {
          id: `${sessionId}-attachment-${index}`,
          name: `Audio ${index + 1}`,
          kind: "audio",
          mimeType: source.mimeType,
          url:
            source.type === "base64_audio_source"
              ? `data:${source.mimeType};base64,${source.data}`
              : undefined,
        },
      ];
    }

    if (part.type === "document") {
      const source = part.source;
      const mimeType =
        source.type === "text_document_source" ||
        source.type === "base64_document_source" ||
        source.type === "object_storage_document_source"
          ? source.mediaType
          : "application/octet-stream";
      return [
        {
          id: `${sessionId}-attachment-${index}`,
          name: `Document ${index + 1}`,
          kind: "document",
          mimeType,
          url:
            source.type === "base64_document_source"
              ? `data:${source.mediaType};base64,${source.data}`
              : source.type === "url_document_source"
                ? source.url
                : undefined,
        },
      ];
    }

    return [];
  });
}

async function attachmentsToContentParts(
  attachments: readonly DemoAttachmentInput[],
): Promise<LLM.UserContentPart[]> {
  const parts: LLM.UserContentPart[] = [];

  for (const attachment of attachments) {
    const file = attachment.file;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = LLM.uint8ArrayToBase64(bytes);
    const mimeType = file.type || "application/octet-stream";

    if (mimeType.startsWith("image/")) {
      parts.push({
        type: "image",
        source: {
          type: "base64_image_source",
          data: base64,
          mimeType: mimeType as LLM.ImageMimeType,
        },
      });
      continue;
    }

    if (mimeType.startsWith("audio/")) {
      parts.push({
        type: "audio",
        source: {
          type: "base64_audio_source",
          data: base64,
          mimeType: mimeType as LLM.AudioMimeType,
        },
      });
      continue;
    }

    if (mimeType === "application/pdf") {
      parts.push({
        type: "document",
        source: {
          type: "base64_document_source",
          data: base64,
          mediaType: "application/pdf",
        },
      });
      continue;
    }

    if (isTextAttachment(mimeType)) {
      parts.push({
        type: "document",
        source: {
          type: "text_document_source",
          data: await file.text(),
          mediaType: mimeType as LLM.DocumentTextMimeType,
        },
      });
      continue;
    }

    parts.push({
      type: "text",
      text: `[Attached file: ${file.name || "file"} (${mimeType})]`,
    });
  }

  return parts;
}

function isTextAttachment(mimeType: string): boolean {
  return (
    mimeType === "application/json" ||
    mimeType === "text/plain" ||
    mimeType === "application/x-javascript" ||
    mimeType === "text/javascript" ||
    mimeType === "application/x-python" ||
    mimeType === "text/x-python" ||
    mimeType === "text/html" ||
    mimeType === "text/css" ||
    mimeType === "text/xml" ||
    mimeType === "text/rtf"
  );
}
