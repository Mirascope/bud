import type * as LLM from "@bud/llm";

/**
 * Rough token estimate for a single message.
 * Deliberately conservative: overestimates to trigger compaction early
 * rather than risk overflow.
 */
export function estimateMessageTokens(message: LLM.Message): number {
  if (message.role === "system") {
    return Math.ceil(message.content.text.length / 4);
  }

  let tokens = 0;
  for (const part of message.content) {
    if (part.type === "text") {
      tokens += Math.ceil(part.text.length / 4);
    } else if (part.type === "tool_call") {
      tokens += Math.ceil(part.args.length / 2);
    } else if (part.type === "tool_output") {
      tokens += Math.ceil(part.result.length / 2);
    } else if (
      part.type === "image" ||
      part.type === "audio" ||
      part.type === "document"
    ) {
      tokens += 2000;
    }
  }
  return tokens;
}

export function estimateTokens(messages: LLM.Message[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  return total;
}

export function totalInputTokens(response: LLM.Response): number {
  const tokens = response.usage.tokens;
  return tokens.input + tokens.cacheRead + tokens.cacheWrite;
}
