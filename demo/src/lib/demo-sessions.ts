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
    }
  | {
      readonly id: string;
      readonly type: "tool";
      readonly status: "active" | "done" | "error";
      readonly title: string;
      readonly input?: unknown;
      readonly output?: unknown;
    };

export type DemoActivityEvent =
  | { readonly type: "thought"; readonly delta: string }
  | {
      readonly type: "tool_call";
      readonly id: string;
      readonly name: string;
      readonly args: unknown;
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
  const withTitles = await Promise.all(
    summaries.map(async (summary) => ({
      sessionId: summary.sessionId as SessionId,
      title: await titleForSession(summary),
      lastActiveAt: summary.lastActiveAt,
    })),
  );

  return withTitles;
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
        if (event.type === "error") {
          return Effect.fail(new Error(event.message));
        }

        return Effect.sync(() => {
          switch (event.type) {
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
  const messages = await loadDemoMessages(summary.sessionId as SessionId);
  const firstUserMessage = messages.find((message) => message.role === "user");
  return truncateTitle(firstUserMessage?.content || "Attachment");
}

function truncateTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length <= 42) return normalized;
  return `${normalized.slice(0, 39)}...`;
}

function textFromParts(
  parts: readonly { readonly type: string; readonly text?: string }[],
): string {
  const text = parts
    .filter(
      (part): part is { readonly type: "text"; readonly text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
  return text;
}

function activitiesFromAssistantParts(
  messageId: string,
  parts: readonly LLM.AssistantContentPart[],
): readonly DemoActivity[] {
  const activities: DemoActivity[] = [];
  let thoughtIndex = 0;

  for (const part of parts) {
    if (part.type === "thought") {
      activities.push({
        id: `${messageId}-thinking-${thoughtIndex++}`,
        type: "thinking",
        status: "done",
        title: "Thinking",
        content: part.thought,
      });
      continue;
    }

    if (part.type === "tool_call") {
      activities.push({
        id: `${messageId}-tool-${part.id}`,
        type: "tool",
        status: "done",
        title: part.name,
        input: safeParseJson(part.args),
      });
    }
  }

  return activities;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function attachmentsFromParts(
  sessionId: SessionId,
  parts: readonly LLM.UserContentPart[],
): readonly DemoAttachment[] {
  return parts.flatMap((part, index): readonly DemoAttachment[] => {
    const id = `${sessionId}-attachment-${index}`;

    switch (part.type) {
      case "image":
        return [
          {
            id,
            kind: "image",
            name: "Image",
            mimeType:
              "mimeType" in part.source ? part.source.mimeType : "image/*",
            url:
              part.source.type === "base64_image_source"
                ? dataUrl(part.source.mimeType, part.source.data)
                : part.source.type === "url_image_source"
                  ? part.source.url
                  : undefined,
          },
        ];

      case "audio":
        return [
          {
            id,
            kind: "audio",
            name: "Audio",
            mimeType: part.source.mimeType,
            url:
              part.source.type === "base64_audio_source"
                ? dataUrl(part.source.mimeType, part.source.data)
                : undefined,
          },
        ];

      case "document":
        return [
          {
            id,
            kind: "document",
            name:
              part.source.type === "base64_document_source" &&
              part.source.mediaType === "application/pdf"
                ? "PDF"
                : "Document",
            mimeType:
              "mediaType" in part.source
                ? part.source.mediaType
                : "application/octet-stream",
          },
        ];

      default:
        return [];
    }
  });
}

async function attachmentsToContentParts(
  attachments: readonly DemoAttachmentInput[],
): Promise<LLM.UserContentPart[]> {
  const parts: LLM.UserContentPart[] = [];

  for (const attachment of attachments) {
    const bytes = new Uint8Array(await attachment.file.arrayBuffer());
    const contentPart = contentPartFromFile(attachment.file, bytes);
    if (contentPart) parts.push(contentPart);
  }

  return parts;
}

function contentPartFromFile(
  file: File,
  bytes: Uint8Array,
): LLM.UserContentPart | null {
  if (file.type.startsWith("image/")) {
    return LLM.imageFromBytes(bytes);
  }

  if (file.type.startsWith("audio/")) {
    return LLM.audioFromBytes(bytes);
  }

  const documentMimeType = documentMimeTypeForFile(file);
  if (documentMimeType) {
    return LLM.documentFromBytes(bytes, { mimeType: documentMimeType });
  }

  return null;
}

function documentMimeTypeForFile(
  file: File,
): LLM.DocumentTextMimeType | LLM.DocumentBase64MimeType | null {
  if (file.type === "application/pdf") return "application/pdf";
  if (file.type === "application/json") return "application/json";
  if (file.type === "text/plain") return "text/plain";
  if (file.type === "text/javascript") return "text/javascript";
  if (file.type === "text/html") return "text/html";
  if (file.type === "text/css") return "text/css";
  if (file.type === "text/xml") return "text/xml";
  if (file.type === "text/rtf") return "text/rtf";

  const extension = file.name.slice(file.name.lastIndexOf("."));
  if (!extension) return null;

  try {
    return LLM.mimeTypeFromExtension(extension);
  } catch {
    return null;
  }
}

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}
