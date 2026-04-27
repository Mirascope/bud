import { WebCrypto } from "@bud/crypto";
import * as LLM from "@bud/llm";
import { IndexedDB } from "@bud/object-storage";
import {
  makeSessionsLocalStorage,
  type SessionId,
  type SessionSummary,
  type SessionsService,
} from "@bud/sessions";
import { Effect } from "effect";

export interface DemoMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: string;
  readonly attachments?: readonly DemoAttachment[];
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

const MODEL_ID = "demo/not-implemented";
const ASSISTANT_FALLBACK = "Not Implemented Yet";
const crypto = WebCrypto.make();

let sessions: SessionsService | null = null;

export async function listDemoSessions(): Promise<DemoSession[]> {
  const summaries = await Effect.runPromise(getSessions().summarize("bud"));
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
    await Effect.runPromise(getSessions().open(sessionId));
    return sessionId;
  }

  const existing = await listDemoSessions();
  const firstSession = existing[0]?.sessionId;
  if (firstSession) return firstSession;

  return createDemoSession();
}

export async function createDemoSession(): Promise<SessionId> {
  const sessionId = `bud:demo-${crypto.randomUUID()}` as SessionId;
  await Effect.runPromise(
    getSessions().create({
      sessionId,
      modelId: MODEL_ID,
    }),
  );
  return sessionId;
}

export async function deleteDemoSession(sessionId: SessionId): Promise<void> {
  await Effect.runPromise(getSessions().delete(sessionId));
}

export async function loadDemoMessages(
  sessionId: SessionId,
): Promise<DemoMessage[]> {
  const [messages, turns] = await Promise.all([
    Effect.runPromise(getSessions().messages(sessionId)),
    Effect.runPromise(getSessions().turns(sessionId)),
  ]);
  const messageTurns = turns.filter(
    (turn) => turn.type === "user_turn" || turn.type === "assistant_turn",
  );

  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message, index) => ({
      id: `${sessionId}-${index}`,
      role: message.role,
      content: textFromParts(message.content),
      timestamp: messageTurns[index]?.timestamp ?? new Date(0).toISOString(),
      attachments:
        message.role === "user"
          ? attachmentsFromParts(sessionId, message.content)
          : undefined,
    }));
}

export async function addDemoExchange(
  sessionId: SessionId,
  userText: string,
  attachments: readonly DemoAttachmentInput[] = [],
): Promise<DemoMessage[]> {
  const content: LLM.UserContentPart[] = userText
    ? [{ type: "text", text: userText }]
    : [];
  content.push(...(await attachmentsToContentParts(attachments)));

  await Effect.runPromise(
    getSessions().addUserTurn(sessionId, LLM.user(content)),
  );
  await Effect.runPromise(
    getSessions().addAssistantTurn(
      sessionId,
      new LLM.Response({
        content: [{ type: "text", text: ASSISTANT_FALLBACK }],
        providerId: "demo",
        modelId: MODEL_ID,
        providerModelName: MODEL_ID,
        inputMessages: [],
        tools: [],
        toolSchemas: [],
      }),
    ),
  );

  return loadDemoMessages(sessionId);
}

export interface DemoAttachmentInput {
  readonly file: File;
}

function getSessions(): SessionsService {
  sessions ??= makeSessionsLocalStorage(
    IndexedDB.make({
      databaseName: "bud-demo",
      keyPrefix: "demo",
    }),
    { namespace: "bud/demo/sessions" },
  );
  return sessions;
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
