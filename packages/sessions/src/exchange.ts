import type {
  AssistantTurn,
  SessionEntry,
  UserTurn,
} from "./sessions.schemas.ts";
import type { UserContentPart } from "@bud/llm";

function isRealUserTurn(entry: SessionEntry): entry is UserTurn {
  if (entry.type !== "user_turn") return false;
  const content = entry.message.content as readonly UserContentPart[];
  return content.some((part) => part.type !== "tool_output");
}

function isTurn(entry: SessionEntry): entry is UserTurn | AssistantTurn {
  return entry.type === "user_turn" || entry.type === "assistant_turn";
}

export type ExchangeItem = (UserTurn | AssistantTurn)[] | SessionEntry;

export function groupExchanges(entries: SessionEntry[]): ExchangeItem[] {
  const result: ExchangeItem[] = [];
  let pending: (UserTurn | AssistantTurn)[] | null = null;
  let hasAssistant = false;

  function flush() {
    if (pending) {
      result.push(pending);
      pending = null;
      hasAssistant = false;
    }
  }

  for (const entry of entries) {
    if (isRealUserTurn(entry)) {
      if (pending && hasAssistant) {
        flush();
      }
      if (pending) {
        pending.push(entry);
      } else {
        pending = [entry];
      }
      continue;
    }

    if (pending && isTurn(entry)) {
      const turn = entry;
      if (turn.type === "assistant_turn") hasAssistant = true;
      pending.push(turn);
      continue;
    }

    flush();
    result.push(entry);
  }

  flush();
  return result;
}
