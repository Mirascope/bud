import type { SessionEntry } from "./sessions.schemas.ts";
import type * as LLM from "@bud/llm";

const TOOL_OUTPUT_LIMIT = 4096;

export function stripHeavyContent(entry: SessionEntry): void {
  switch (entry.type) {
    case "user_turn":
      stripContentParts(entry.message.content as LLM.UserContentPart[]);
      break;
    case "assistant_turn":
      (entry.response as { rawMessage: unknown }).rawMessage = null;
      stripContentParts(entry.response.content as LLM.AssistantContentPart[]);
      break;
  }
}

type AnyContentPart = LLM.UserContentPart | LLM.AssistantContentPart;

function stripContentParts(parts: AnyContentPart[]): void {
  for (const part of parts) {
    switch (part.type) {
      case "image":
      case "audio":
      case "document":
        stripBase64Source(part.source as { type: string; data?: string });
        break;
      case "tool_output":
        if (part.result.length > TOOL_OUTPUT_LIMIT) {
          const fullLength = part.result.length;
          (part as { result: string }).result =
            part.result.slice(0, TOOL_OUTPUT_LIMIT) +
            `\n\n[...truncated, ${(fullLength / 1024).toFixed(0)}KB total]`;
        }
        break;
    }
  }
}

function stripBase64Source(source: { type: string; data?: string }): void {
  if (typeof source.data !== "string") return;
  if (
    source.type === "base64_image_source" ||
    source.type === "base64_audio_source" ||
    source.type === "base64_document_source"
  ) {
    const byteLength = source.data.length;
    source.data = `[${source.type} ${(byteLength / 1024).toFixed(0)}KB stripped]`;
  }
}
