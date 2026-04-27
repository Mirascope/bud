import * as LLM from "@bud/llm";
import { IndexedDB } from "@bud/object-storage";
import {
  makeSessionsLocalStorage,
  type SessionId,
  type SessionSummary,
} from "@bud/sessions";
import { Effect } from "effect";

export interface DemoMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface DemoSession {
  readonly sessionId: SessionId;
  readonly title: string;
  readonly lastActiveAt: string;
}

const MODEL_ID = "demo/not-implemented";
const ASSISTANT_FALLBACK = "Not Implemented Yet";

const sessions = makeSessionsLocalStorage(
  IndexedDB.make({
    databaseName: "bud-demo",
    keyPrefix: "demo",
  }),
  { namespace: "bud/demo/sessions" },
);

export async function listDemoSessions(): Promise<DemoSession[]> {
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
    await Effect.runPromise(sessions.open(sessionId));
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
    sessions.create({
      sessionId,
      modelId: MODEL_ID,
    }),
  );
  return sessionId;
}

export async function loadDemoMessages(
  sessionId: SessionId,
): Promise<DemoMessage[]> {
  const messages = await Effect.runPromise(sessions.messages(sessionId));

  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message, index) => ({
      id: `${sessionId}-${index}`,
      role: message.role,
      content: textFromParts(message.content),
    }));
}

export async function addDemoExchange(
  sessionId: SessionId,
  userText: string,
): Promise<DemoMessage[]> {
  await Effect.runPromise(sessions.addUserTurn(sessionId, LLM.user(userText)));
  await Effect.runPromise(
    sessions.addAssistantTurn(
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

async function titleForSession(summary: SessionSummary): Promise<string> {
  const messages = await loadDemoMessages(summary.sessionId as SessionId);
  const firstUserMessage = messages.find((message) => message.role === "user");
  return truncateTitle(firstUserMessage?.content ?? "New session");
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
  return text || "[Unsupported content]";
}
