/**
 * Content types for LLM messages.
 */
import { Audio } from "./audio.ts";
import { Document } from "./document.ts";
import { Image } from "./image.ts";
import { Text } from "./text.ts";
import { Thought } from "./thought.ts";
import { ToolCall } from "./tool-call.ts";
import { ToolOutput } from "./tool-output.ts";
import { Schema } from "effect";

// Content part unions

export const UserContentPart = Schema.Union(
  Text,
  Image,
  Audio,
  Document,
  ToolOutput,
);
export type UserContentPart = typeof UserContentPart.Type;

export const AssistantContentPart = Schema.Union(Text, ToolCall, Thought);
export type AssistantContentPart = typeof AssistantContentPart.Type;

export const ContentPart = Schema.Union(
  Text,
  Image,
  Audio,
  Document,
  ToolOutput,
  ToolCall,
  Thought,
);
export type ContentPart = typeof ContentPart.Type;

// Re-exports

export { Text } from "./text.ts";
export {
  Image,
  type ImageMimeType,
  type Base64ImageSource,
  type URLImageSource,
  type ObjectStorageImageSource,
} from "./image.ts";
export {
  Audio,
  type AudioMimeType,
  type Base64AudioSource,
  type ObjectStorageAudioSource,
} from "./audio.ts";
export {
  Document,
  type DocumentTextMimeType,
  type DocumentBase64MimeType,
  type Base64DocumentSource,
  type TextDocumentSource,
  type URLDocumentSource,
  type ObjectStorageDocumentSource,
} from "./document.ts";
export { Thought } from "./thought.ts";
export { ToolCall } from "./tool-call.ts";
export { ToolOutput } from "./tool-output.ts";

// Factory helpers
export {
  imageFromUrl,
  imageFromBytes,
  uint8ArrayToBase64,
  inferImageType,
} from "./image.ts";
export { audioFromBytes, inferAudioType } from "./audio.ts";
export {
  documentFromUrl,
  documentFromBytes,
  mimeTypeFromExtension,
  inferDocumentType,
} from "./document.ts";
export {
  toolOutputSuccess,
  toolOutputFailure,
  ZERO_USAGE,
  type ToolResult,
  type ToolResultContentPart,
  toolResult,
} from "./tool-output.ts";

// Streaming chunks
export {
  TextStartChunk,
  TextChunk,
  TextEndChunk,
  textStart,
  textChunk,
  textEnd,
} from "./text.ts";
export {
  ThoughtStartChunk,
  ThoughtChunk,
  ThoughtEndChunk,
  thoughtStart,
  thoughtChunk,
  thoughtEnd,
} from "./thought.ts";
export {
  ToolCallStartChunk,
  ToolCallChunk,
  ToolCallEndChunk,
  toolCallStart,
  toolCallChunk,
  toolCallEnd,
} from "./tool-call.ts";
