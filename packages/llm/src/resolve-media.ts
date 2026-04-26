import { uint8ArrayToBase64 } from "./content/image.ts";
import type { UserContentPart } from "./content/index.ts";
import type { Message } from "./messages/message.ts";

export interface ResolvedMedia {
  readonly data: Uint8Array;
  readonly mimeType: string;
}

export type MediaUrlResolver = (url: string) => Promise<ResolvedMedia | null>;

/**
 * Walk every message's content and replace URL-sourced media with
 * base64-sourced media. Returns a fresh array; the input messages are
 * left intact.
 */
export async function inlineMediaUrls(
  messages: readonly Message[],
  resolver: MediaUrlResolver,
): Promise<Message[]> {
  const out: Message[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      out.push(message);
      continue;
    }

    const content = message.content;
    if (content.length === 0) {
      out.push(message);
      continue;
    }

    const nextParts: UserContentPart[] = [];
    let changed = false;
    for (const part of content) {
      const resolved = await resolvePart(part, resolver);
      if (resolved !== part) changed = true;
      nextParts.push(resolved);
    }

    out.push(changed ? { ...message, content: nextParts } : message);
  }
  return out;
}

async function resolvePart(
  part: UserContentPart,
  resolver: MediaUrlResolver,
): Promise<UserContentPart> {
  if (part.type === "image" && part.source.type === "url_image_source") {
    const media = await resolver(part.source.url);
    if (!media) return part;
    const mimeType = pickImageMime(media.mimeType);
    if (!mimeType) return part;
    return {
      type: "image",
      source: {
        type: "base64_image_source",
        data: uint8ArrayToBase64(media.data),
        mimeType,
      },
    };
  }

  if (part.type === "document" && part.source.type === "url_document_source") {
    const media = await resolver(part.source.url);
    if (!media) return part;
    if (media.mimeType !== "application/pdf") return part;
    return {
      type: "document",
      source: {
        type: "base64_document_source",
        data: uint8ArrayToBase64(media.data),
        mediaType: "application/pdf",
      },
    };
  }

  return part;
}

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

function pickImageMime(
  raw: string,
):
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/heic"
  | "image/heif"
  | null {
  return ALLOWED_IMAGE_MIMES.has(raw)
    ? (raw as
        | "image/png"
        | "image/jpeg"
        | "image/webp"
        | "image/gif"
        | "image/heic"
        | "image/heif")
    : null;
}
