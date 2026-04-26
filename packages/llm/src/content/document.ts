/**
 * Document content for messages.
 *
 * Supports text documents (JSON, plain text, code) and binary documents (PDF).
 */
import { uint8ArrayToBase64 } from "./image.ts";
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

export const DocumentTextMimeType = Schema.Literal(
  "application/json",
  "text/plain",
  "application/x-javascript",
  "text/javascript",
  "application/x-python",
  "text/x-python",
  "text/html",
  "text/css",
  "text/xml",
  "text/rtf",
);
export type DocumentTextMimeType = typeof DocumentTextMimeType.Type;

export const DocumentBase64MimeType = Schema.Literal("application/pdf");
export type DocumentBase64MimeType = typeof DocumentBase64MimeType.Type;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const Base64DocumentSource = Schema.Struct({
  type: Schema.Literal("base64_document_source"),
  /** The document data, as a base64 encoded string. */
  data: Schema.String,
  /** The media type of the document. */
  mediaType: DocumentBase64MimeType,
});
export type Base64DocumentSource = typeof Base64DocumentSource.Type;

export const TextDocumentSource = Schema.Struct({
  type: Schema.Literal("text_document_source"),
  /** The document data, as plain text. */
  data: Schema.String,
  /** The media type of the document. */
  mediaType: DocumentTextMimeType,
});
export type TextDocumentSource = typeof TextDocumentSource.Type;

export const URLDocumentSource = Schema.Struct({
  type: Schema.Literal("url_document_source"),
  /** The URL of the document. */
  url: Schema.String,
});
export type URLDocumentSource = typeof URLDocumentSource.Type;

export const ObjectStorageDocumentSource = Schema.Struct({
  type: Schema.Literal("object_storage_document_source"),
  /** Object storage key for the document bytes. */
  key: Schema.String,
  /** The media type of the document. */
  mediaType: DocumentBase64MimeType,
});
export type ObjectStorageDocumentSource =
  typeof ObjectStorageDocumentSource.Type;

export const DocumentSource = Schema.Union(
  Base64DocumentSource,
  TextDocumentSource,
  URLDocumentSource,
  ObjectStorageDocumentSource,
);
export type DocumentSource = typeof DocumentSource.Type;

// ---------------------------------------------------------------------------
// Document content part
// ---------------------------------------------------------------------------

export const Document = Schema.Struct({
  type: Schema.Literal("document"),
  source: DocumentSource,
});
export type Document = typeof Document.Type;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const EXTENSION_TO_MIME: Record<
  string,
  DocumentTextMimeType | DocumentBase64MimeType
> = {
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".txt": "text/plain",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".py": "text/x-python",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".xml": "text/xml",
  ".rtf": "text/rtf",
};

const TEXT_MIME_TYPES = new Set<string>([
  "application/json",
  "text/plain",
  "application/x-javascript",
  "text/javascript",
  "application/x-python",
  "text/x-python",
  "text/html",
  "text/css",
  "text/xml",
  "text/rtf",
]);

/** Infer document MIME type from file extension. */
export function mimeTypeFromExtension(
  ext: string,
): DocumentTextMimeType | DocumentBase64MimeType {
  const mimeType = EXTENSION_TO_MIME[ext.toLowerCase()];
  if (!mimeType) throw new Error(`Unsupported document file extension: ${ext}`);
  return mimeType;
}

/** Detect PDF from magic bytes. */
export function inferDocumentType(
  data: Uint8Array,
): DocumentBase64MimeType | null {
  if (
    data.length >= 4 &&
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46
  ) {
    return "application/pdf";
  }
  return null;
}

function isTextMimeType(
  mimeType: DocumentTextMimeType | DocumentBase64MimeType,
): mimeType is DocumentTextMimeType {
  return TEXT_MIME_TYPES.has(mimeType);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create a Document from a URL reference. */
export function documentFromUrl(url: string): Document {
  return { type: "document", source: { type: "url_document_source", url } };
}

/** Create a Document from raw bytes. */
export function documentFromBytes(
  data: Uint8Array,
  options?: { mimeType?: DocumentTextMimeType | DocumentBase64MimeType },
): Document {
  const mimeType = options?.mimeType ?? inferDocumentType(data);
  if (!mimeType) {
    throw new Error(
      "Cannot infer document type from bytes. Please provide a mimeType option.",
    );
  }
  if (isTextMimeType(mimeType)) {
    const text = new TextDecoder().decode(data);
    return {
      type: "document",
      source: { type: "text_document_source", data: text, mediaType: mimeType },
    };
  }
  const base64 = uint8ArrayToBase64(data);
  return {
    type: "document",
    source: {
      type: "base64_document_source",
      data: base64,
      mediaType: mimeType,
    },
  };
}
