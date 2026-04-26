import type { Usage } from "@bud/llm";
import type { ThinkingLevel } from "@bud/sessions";

export interface SessionEvent {
  readonly type: "session";
  readonly sessionId: string;
}

export interface TextDeltaEvent {
  readonly type: "text";
  readonly delta: string;
}

export interface ThoughtDeltaEvent {
  readonly type: "thought";
  readonly delta: string;
}

export interface ToolCallEvent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

export interface ToolResultEvent {
  readonly type: "tool_result";
  readonly id: string;
  readonly ok: boolean;
  readonly output: unknown;
}

export interface TurnEndEvent {
  readonly type: "turn_end";
}

export interface DoneEvent {
  readonly type: "done";
  readonly sessionId: string;
  readonly usage: Usage;
  readonly capped: boolean;
  readonly modelId?: string;
  readonly thinkingLevel?: ThinkingLevel | null;
}

export interface ErrorEvent {
  readonly type: "error";
  readonly message: string;
}

export type AgentStreamEvent =
  | SessionEvent
  | TextDeltaEvent
  | ThoughtDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnEndEvent
  | DoneEvent
  | ErrorEvent;

export function encodeSseEvent(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function parseSseEvent(data: string): AgentStreamEvent | null {
  try {
    const parsed = JSON.parse(data);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.type === "string"
    ) {
      return parsed as AgentStreamEvent;
    }
    return null;
  } catch {
    return null;
  }
}
