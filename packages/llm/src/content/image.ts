/**
 * Image content for messages.
 *
 * Images can be included in user messages for multimodal models.
 * Source can be base64-encoded data or a URL reference.
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

export const ImageMimeType = Schema.Literal(
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
);
export type ImageMimeType = typeof ImageMimeType.Type;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const Base64ImageSource = Schema.Struct({
  type: Schema.Literal("base64_image_source"),
  /** The image data, as a base64 encoded string. */
  data: Schema.String,
  /** The MIME type of the image. */
  mimeType: ImageMimeType,
});
export type Base64ImageSource = typeof Base64ImageSource.Type;

export const URLImageSource = Schema.Struct({
  type: Schema.Literal("url_image_source"),
  /** The URL of the image. */
  url: Schema.String,
});
export type URLImageSource = typeof URLImageSource.Type;

export const ImageSource = Schema.Union(Base64ImageSource, URLImageSource);
export type ImageSource = typeof ImageSource.Type;

// ---------------------------------------------------------------------------
// Image content part
// ---------------------------------------------------------------------------

export const Image = Schema.Struct({
  type: Schema.Literal("image"),
  source: ImageSource,
});
export type Image = typeof Image.Type;

/** An image content part whose source is always inline base64. */
export interface Base64Image {
  readonly type: "image";
  readonly source: Base64ImageSource;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum image size in bytes (20MB). */
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Infer the MIME type of an image from its magic bytes. */
export function inferImageType(data: Uint8Array): ImageMimeType {
  if (data.length < 12) {
    throw new Error(
      "Image data too small to determine type (minimum 12 bytes)",
    );
  }

  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return "image/gif";
  }

  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }

  if (
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70
  ) {
    const subtype = String.fromCharCode(
      data[8]!,
      data[9]!,
      data[10]!,
      data[11]!,
    );
    if (subtype === "heic" || subtype === "heix") return "image/heic";
    if (["mif1", "msf1", "hevc", "hevx"].includes(subtype)) return "image/heif";
  }

  throw new Error("Unsupported image type");
}

/** Convert a Uint8Array to a base64 string. */
export function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create an Image from a URL reference (no download). */
export function imageFromUrl(url: string): Image {
  return { type: "image", source: { type: "url_image_source", url } };
}

/** Create an Image from raw bytes. */
export function imageFromBytes(
  data: Uint8Array,
  maxSize = MAX_IMAGE_SIZE,
): Image {
  if (data.length > maxSize) {
    throw new Error(
      `Image size (${data.length} bytes) exceeds maximum (${maxSize} bytes)`,
    );
  }
  const mimeType = inferImageType(data);
  const base64 = uint8ArrayToBase64(data);
  return {
    type: "image",
    source: { type: "base64_image_source", data: base64, mimeType },
  };
}
