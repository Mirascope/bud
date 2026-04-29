import { getCompactUserSummaryMessage } from "./compact-prompt.ts";
import type { SessionEntry, Turn } from "./sessions.schemas.ts";
import type * as LLM from "@bud/llm";

export function responseDataToAssistantMessage(
  response: LLM.ResponseData,
): LLM.AssistantMessage {
  return {
    role: "assistant",
    content: [...response.content] as LLM.AssistantContentPart[],
    name: null,
    providerId: response.providerId,
    modelId: response.modelId,
    providerModelName: response.providerModelName,
    rawMessage: response.rawMessage,
  };
}

export function messagesFromSegmentEntries(
  entries: readonly SessionEntry[],
): LLM.Message[] {
  const first = entries[0];
  const compactionSummary =
    first?.type === "compaction" ? first.summary : undefined;

  const turns = entries.filter(
    (entry): entry is Turn =>
      entry.type === "user_turn" || entry.type === "assistant_turn",
  );
  if (turns.length === 0) return [];

  const messages: LLM.Message[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    if (i === 0 && compactionSummary && turn.type === "user_turn") {
      const summaryFraming = getCompactUserSummaryMessage(compactionSummary);
      const content = turn.message.content as readonly LLM.UserContentPart[];
      const userText = content
        .filter(
          (part: LLM.UserContentPart): part is LLM.Text => part.type === "text",
        )
        .map((part: LLM.Text) => part.text)
        .join("\n");

      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `${summaryFraming}\n\n---\n\n${userText}`,
          },
        ],
        name: turn.message.name,
      });
    } else if (turn.type === "user_turn") {
      messages.push(turn.message);
    } else if (turn.type === "assistant_turn") {
      messages.push(responseDataToAssistantMessage(turn.response));
    }
  }

  return stripDanglingToolCalls(messages);
}

function stripDanglingToolCalls(
  messages: readonly LLM.Message[],
): LLM.Message[] {
  return messages.flatMap((message, index): readonly LLM.Message[] => {
    if (message.role !== "assistant") return [message];

    const toolCallIds = message.content
      .filter((part): part is LLM.ToolCall => part.type === "tool_call")
      .map((part) => part.id);
    if (toolCallIds.length === 0) return [message];

    const next = messages[index + 1];
    const outputIds =
      next?.role === "user"
        ? new Set(
            next.content
              .filter(
                (part): part is LLM.ToolOutput => part.type === "tool_output",
              )
              .map((part) => part.id),
          )
        : new Set<string>();
    const hasAllOutputs = toolCallIds.every((id) => outputIds.has(id));
    if (hasAllOutputs) return [message];

    const content = message.content.filter((part) => part.type !== "tool_call");
    return content.length > 0 ? [{ ...message, content }] : [];
  });
}
