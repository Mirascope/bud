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

interface WorkerRequest {
  readonly type: "call" | "stream";
  readonly id: string;
  readonly method: string;
  readonly payload?: unknown;
}

type WorkerResponse =
  | {
      readonly type: "success";
      readonly id: string;
      readonly payload?: unknown;
    }
  | {
      readonly type: "error";
      readonly id: string;
      readonly message: string;
    }
  | {
      readonly type: "event";
      readonly id: string;
      readonly event: unknown;
    };

interface DemoAttachmentInput {
  readonly file: File;
}

const budPromises = new Map<string, Promise<BudService>>();
let webLLMProvider: LLM.WebLLMProviderService | null = null;
const progressListeners = new Set<(status: string) => void>();

const scope = globalThis as unknown as SharedWorkerGlobalScope;

scope.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (!port) return;

  port.onmessage = (messageEvent: MessageEvent<WorkerRequest>) => {
    const message = messageEvent.data;
    void handleMessage(port, message);
  };
  port.start();
};

async function handleMessage(
  port: MessagePort,
  message: WorkerRequest,
): Promise<void> {
  try {
    const payload =
      message.type === "stream"
        ? await handleStream(port, message)
        : await handleCall(message.method, message.payload);
    post(port, { type: "success", id: message.id, payload });
  } catch (error) {
    post(port, {
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleStream(
  port: MessagePort,
  message: WorkerRequest,
): Promise<unknown> {
  switch (message.method) {
    case "addExchange": {
      const payload = message.payload as {
        readonly sessionId: SessionId;
        readonly userText: string;
        readonly attachments: readonly DemoAttachmentInput[];
        readonly modelId?: string;
        readonly thinkingLevel?: ThinkingLevel | null;
      };
      return addExchange(payload, (event) =>
        post(port, { type: "event", id: message.id, event }),
      );
    }
    default:
      return handleCall(message.method, message.payload);
  }
}

async function handleCall(method: string, payload: unknown): Promise<unknown> {
  switch (method) {
    case "listSessions":
      return listSessions();
    case "createSession": {
      const settings = payload as {
        readonly modelId: string;
        readonly thinkingLevel: ThinkingLevel | null;
      };
      return createSessionHeader(settings.modelId, settings.thinkingLevel);
    }
    case "deleteSession": {
      const { sessionId } = payload as { readonly sessionId: SessionId };
      const sessions = await getSessions();
      await Effect.runPromise(sessions.delete(sessionId));
      return null;
    }
    case "openSession": {
      const { sessionId } = payload as { readonly sessionId: SessionId };
      const sessions = await getSessions();
      await Effect.runPromise(sessions.open(sessionId));
      return sessionId;
    }
    case "loadMessages": {
      const { sessionId } = payload as { readonly sessionId: SessionId };
      return loadMessages(sessionId);
    }
    default:
      throw new Error(`Unknown Spider gateway method: ${method}`);
  }
}

function post(port: MessagePort, message: WorkerResponse): void {
  port.postMessage(message);
}

async function listSessions(): Promise<
  readonly {
    readonly sessionId: SessionId;
    readonly title: string;
    readonly lastActiveAt: string;
  }[]
> {
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

async function createSessionHeader(
  modelId: string,
  thinkingLevel: ThinkingLevel | null,
): Promise<SessionHeader> {
  const bud = await getBud(modelId);
  return Effect.runPromise(bud.createSession({ modelId, thinkingLevel }));
}

async function getSessions(): Promise<SessionsService> {
  const bud = await getBud();
  return bud.sessions;
}

async function addExchange(
  options: {
    readonly sessionId: SessionId;
    readonly userText: string;
    readonly attachments: readonly DemoAttachmentInput[];
    readonly modelId?: string;
    readonly thinkingLevel?: ThinkingLevel | null;
  },
  emit: (event: unknown) => void,
): Promise<unknown> {
  const progressListener = (status: string) => emit({ type: "status", status });
  progressListeners.add(progressListener);

  const content: LLM.UserContentPart[] = options.userText
    ? [{ type: "text", text: options.userText }]
    : [];
  try {
    content.push(...(await attachmentsToContentParts(options.attachments)));

    const modelId =
      options.modelId ?? `web-llm/${LLM.WEB_LLM_DEFAULT_MODEL_ID}`;
    const bud = await getBud(modelId);
    const stream = await Effect.runPromise(
      bud.stream({
        sessionId: options.sessionId,
        modelId,
        thinkingLevel: options.thinkingLevel,
        message: LLM.user(content),
      }),
    );

    await Effect.runPromise(
      Stream.runForEach(stream, (event) => Effect.sync(() => emit(event))),
    );

    return loadMessages(options.sessionId);
  } finally {
    progressListeners.delete(progressListener);
  }
}

function getBud(
  modelId = `web-llm/${LLM.WEB_LLM_DEFAULT_MODEL_ID}`,
): Promise<BudService> {
  const cached = budPromises.get(modelId);
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
            stream: (args) => streamHosted("anthropic", args),
          }),
          openAIProvider: ProviderProxy.make({
            id: "openai",
            stream: (args) => streamHosted("openai", args),
          }),
          googleProvider: ProviderProxy.make({
            id: "google",
            stream: (args) => streamHosted("google", args),
          }),
        }),
      ),
    ),
  );
  budPromises.set(modelId, promise);
  return promise;
}

async function streamHosted(
  provider: "anthropic" | "openai" | "google",
  args: LLM.ProviderCallArgs,
): Promise<Response> {
  return fetch("/api/llm-proxy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, args }),
  });
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

async function loadMessages(sessionId: SessionId): Promise<unknown[]> {
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
            ? (message.modelId ?? `web-llm/${LLM.WEB_LLM_DEFAULT_MODEL_ID}`)
            : undefined,
        thinkingLevel: undefined,
        isComplete: message.role === "assistant" ? true : undefined,
      };
    })
    .filter((message) => {
      if (message.role !== "user") return true;
      return Boolean(message.content || (message.attachments?.length ?? 0) > 0);
    });
}

async function titleForSession(summary: SessionSummary): Promise<string> {
  const messages = await loadMessages(summary.sessionId as SessionId);
  const firstUserMessage = messages.find(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "user",
  ) as { readonly content?: string } | undefined;
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
  return parts
    .filter(
      (part): part is { readonly type: "text"; readonly text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function activitiesFromAssistantParts(
  messageId: string,
  parts: readonly LLM.AssistantContentPart[],
): readonly unknown[] {
  const activities: unknown[] = [];
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
        title: activityTitle(part.name),
        input: safeParseJson(part.args),
      });
    }
  }

  return activities;
}

function activityTitle(name: string): string {
  if (name === "computer") return "Computer";
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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
): readonly unknown[] {
  return parts.flatMap((part, index): readonly unknown[] => {
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
  if (file.type.startsWith("image/")) return LLM.imageFromBytes(bytes);
  if (file.type.startsWith("audio/")) return LLM.audioFromBytes(bytes);
  if (file.type === "application/pdf") {
    return {
      type: "document",
      source: {
        type: "base64_document_source",
        mediaType: "application/pdf",
        data: bytesToBase64(bytes),
      },
    };
  }
  if (
    file.type.startsWith("text/") ||
    [
      "application/json",
      "application/javascript",
      "application/xml",
      "text/javascript",
    ].includes(file.type)
  ) {
    return {
      type: "text",
      text: new TextDecoder().decode(bytes),
    };
  }
  return null;
}

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
