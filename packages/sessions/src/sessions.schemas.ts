import type { SegmentsService } from "./segments.schemas.ts";
import * as LLM from "@bud/llm";
import { Context, type Effect, Schema } from "effect";

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export const Scope = Schema.Literal("discord", "slack", "cron", "gws", "bud");
export type Scope = typeof Scope.Type;

// ---------------------------------------------------------------------------
// SessionId
// ---------------------------------------------------------------------------

/**
 * Session identifier: `{scope}:{segment}[:{segment}]*`
 *
 * Examples:
 *   discord:1485809428036063395               - Discord channel
 *   discord:1485809428036063395:1486000000    - Discord thread
 *   discord:dm:123456789:987654321            - Discord DM
 *   slack:C04ABCDEF                           - Slack channel
 *   slack:C04ABCDEF:1234567890.123456         - Slack thread
 *   slack:dm:U04XYZABC                        - Slack DM
 *   cron:daily-report                         - Cron job
 *   gws:email:user@company.com:18f2a3b4c5d6   - GWS email thread
 *   bud:dm:<spriteId>:<userId>                - Bud in-app DM
 *   bud:<channelId>                           - Bud channel
 *   bud:<channelId>:<threadId>                - Bud thread
 */
export const SessionId = Schema.String.pipe(
  Schema.pattern(/^(discord|slack|cron|gws|bud)(:[a-zA-Z0-9._@-]+)+$/),
  Schema.annotations({
    description:
      "Session ID: {scope}:{segment}[:{segment}]* where scope is discord|slack|cron|gws|bud",
  }),
);
export type SessionId = typeof SessionId.Type;

export function scopeFromSessionId(sessionId: string): Scope {
  return sessionId.split(":")[0] as Scope;
}

// ---------------------------------------------------------------------------
// Turn types
// ---------------------------------------------------------------------------

export const UserTurn = Schema.Struct({
  type: Schema.Literal("user_turn"),
  message: LLM.UserMessage,
  timestamp: Schema.String,
});
export type UserTurn = typeof UserTurn.Type;

export const AssistantTurn = Schema.Struct({
  type: Schema.Literal("assistant_turn"),
  response: LLM.ResponseData,
  timestamp: Schema.String,
});
export type AssistantTurn = typeof AssistantTurn.Type;

export const CompactionTurn = Schema.Struct({
  type: Schema.Literal("compaction"),
  summary: Schema.String,
  usage: LLM.UsageSchema,
  timestamp: Schema.String,
});
export type CompactionTurn = typeof CompactionTurn.Type;

export const Turn = Schema.Union(UserTurn, AssistantTurn, CompactionTurn);
export type Turn = typeof Turn.Type;

// ---------------------------------------------------------------------------
// Session header + model update
// ---------------------------------------------------------------------------

export const SessionHeader = Schema.Struct({
  type: Schema.Literal("session_header"),
  sessionId: SessionId,
  modelId: Schema.String,
  timestamp: Schema.String,
  segmentIndex: Schema.optional(Schema.Number),
  pastMessageCount: Schema.optional(Schema.Number),
  systemPromptHash: Schema.optional(Schema.String),
});
export type SessionHeader = typeof SessionHeader.Type;

export const ThinkingLevel = Schema.Literal(
  "minimal",
  "low",
  "medium",
  "high",
  "extra-high",
);
export type ThinkingLevel = typeof ThinkingLevel.Type;

export const ModelUpdate = Schema.Struct({
  type: Schema.Literal("model_update"),
  modelId: Schema.String,
  thinkingLevel: Schema.optional(Schema.NullOr(ThinkingLevel)),
  timestamp: Schema.String,
});
export type ModelUpdate = typeof ModelUpdate.Type;

export const SystemPromptChange = Schema.Struct({
  type: Schema.Literal("system_prompt_change"),
  hash: Schema.String,
  timestamp: Schema.String,
});
export type SystemPromptChange = typeof SystemPromptChange.Type;

// ---------------------------------------------------------------------------
// Prompt snapshot
// ---------------------------------------------------------------------------

export const PromptSnapshotTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.Unknown,
});

export const PromptSnapshot = Schema.Struct({
  systemPrompt: Schema.String,
  tools: Schema.Array(PromptSnapshotTool),
});
export type PromptSnapshot = typeof PromptSnapshot.Type;

export const PromptSnapshotResponse = Schema.Struct({
  hash: Schema.String,
  systemPrompt: Schema.String,
  tools: Schema.Array(PromptSnapshotTool),
});
export type PromptSnapshotResponse = typeof PromptSnapshotResponse.Type;

// ---------------------------------------------------------------------------
// Session entry
// ---------------------------------------------------------------------------

export const SessionEntry = Schema.Union(
  SessionHeader,
  ModelUpdate,
  SystemPromptChange,
  ...Turn.members,
);
export type SessionEntry = typeof SessionEntry.Type;

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export const SessionCostCenticents = Schema.Struct({
  lifetime: Schema.Number,
  weekly: Schema.optional(Schema.Number),
  burst: Schema.optional(Schema.Number),
});
export type SessionCostCenticents = typeof SessionCostCenticents.Type;

export type SessionCostWindows = {
  readonly weeklyWindowStart?: string;
  readonly burstWindowStart?: string;
};

export const SessionSummary = Schema.Struct({
  sessionId: Schema.String,
  scope: Schema.String,
  lastActiveAt: Schema.String,
  costCenticents: SessionCostCenticents,
});
export type SessionSummary = typeof SessionSummary.Type;

export const DropExchangeResponse = Schema.Struct({
  droppedCount: Schema.Number,
});
export type DropExchangeResponse = typeof DropExchangeResponse.Type;

export const SessionEntriesPage = Schema.Struct({
  sessionId: Schema.String,
  entries: Schema.Array(SessionEntry),
  segmentCount: Schema.Number,
  segmentIndex: Schema.Number,
});
export type SessionEntriesPage = typeof SessionEntriesPage.Type;

// ---------------------------------------------------------------------------
// Session error
// ---------------------------------------------------------------------------

export class SessionError extends Schema.TaggedError<SessionError>()(
  "SessionError",
  {
    message: Schema.String,
    sessionId: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

// ---------------------------------------------------------------------------
// Sessions service
// ---------------------------------------------------------------------------

export interface SessionsService {
  readonly list: (
    scope?: Scope,
  ) => Effect.Effect<SessionHeader[], SessionError>;

  readonly summarize: (
    scope?: Scope,
    windows?: SessionCostWindows,
  ) => Effect.Effect<SessionSummary[], SessionError>;

  readonly open: (
    sessionId: SessionId,
  ) => Effect.Effect<SessionHeader, SessionError>;

  readonly create: (options: {
    sessionId: SessionId;
    modelId: string;
    forkFromSessionId?: SessionId;
    systemPromptHash?: string;
  }) => Effect.Effect<SessionHeader, SessionError>;

  readonly recordSystemPrompt: (
    sessionId: SessionId,
    hash: string,
  ) => Effect.Effect<void, SessionError>;

  readonly writePromptSnapshot: (
    systemPrompt: string,
    tools: readonly {
      name: string;
      description: string;
      parameters: unknown;
    }[],
  ) => Effect.Effect<{ hash: string; snapshot: PromptSnapshot }, SessionError>;

  readonly getPromptSnapshot: (
    hash: string,
  ) => Effect.Effect<PromptSnapshotResponse | null, SessionError>;

  readonly addUserTurn: (
    sessionId: SessionId,
    message: LLM.UserMessage,
  ) => Effect.Effect<void, SessionError>;

  readonly addAssistantTurn: (
    sessionId: SessionId,
    response: LLM.Response,
  ) => Effect.Effect<void, SessionError>;

  readonly turns: (sessionId: SessionId) => Effect.Effect<Turn[], SessionError>;

  readonly messages: (
    sessionId: SessionId,
    options?: { systemPrompt?: string },
  ) => Effect.Effect<LLM.Message[], SessionError>;

  readonly compact: (
    sessionId: SessionId,
    options: {
      contextWindowTokens: number;
      systemPrompt?: string;
      systemInstructions?: string;
      instructions?: string;
    },
  ) => Effect.Effect<LLM.Message[], SessionError, LLM.Model>;

  readonly updateModel: (
    sessionId: SessionId,
    modelId: string,
    thinkingLevel?: ThinkingLevel | null,
  ) => Effect.Effect<void, SessionError>;

  readonly currentModelId: (
    sessionId: SessionId,
  ) => Effect.Effect<string, SessionError>;

  readonly currentThinkingLevel: (
    sessionId: SessionId,
  ) => Effect.Effect<ThinkingLevel | null, SessionError>;

  readonly clear: (sessionId: SessionId) => Effect.Effect<void, SessionError>;

  readonly dropLastExchange: (
    sessionId: SessionId,
  ) => Effect.Effect<number, SessionError>;

  readonly delete: (sessionId: SessionId) => Effect.Effect<void, SessionError>;

  readonly lastActivityTimestamp: (
    sessionId: SessionId,
  ) => Effect.Effect<string | null, SessionError>;

  readonly segments: SegmentsService;
}

export class Sessions extends Context.Tag("@bud/sessions/Sessions")<
  Sessions,
  SessionsService
>() {}
