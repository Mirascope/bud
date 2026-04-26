/**
 * Audio content for messages.
 *
 * Audio can be included in user messages for multimodal models.
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

export const AudioMimeType = Schema.Literal(
  "audio/wav",
  "audio/mp3",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
);
export type AudioMimeType = typeof AudioMimeType.Type;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const Base64AudioSource = Schema.Struct({
  type: Schema.Literal("base64_audio_source"),
  /** The audio data, as a base64 encoded string. */
  data: Schema.String,
  /** The MIME type of the audio. */
  mimeType: AudioMimeType,
});
export type Base64AudioSource = typeof Base64AudioSource.Type;

export const ObjectStorageAudioSource = Schema.Struct({
  type: Schema.Literal("object_storage_audio_source"),
  /** Object storage key for the audio bytes. */
  key: Schema.String,
  /** The MIME type of the audio. */
  mimeType: AudioMimeType,
});
export type ObjectStorageAudioSource = typeof ObjectStorageAudioSource.Type;

// ---------------------------------------------------------------------------
// Audio content part
// ---------------------------------------------------------------------------

export const Audio = Schema.Struct({
  type: Schema.Literal("audio"),
  source: Schema.Union(Base64AudioSource, ObjectStorageAudioSource),
});
export type Audio = typeof Audio.Type;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum audio size in bytes (25MB). */
export const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Infer the MIME type of audio from its magic bytes. */
export function inferAudioType(data: Uint8Array): AudioMimeType {
  if (data.length < 12) {
    throw new Error(
      "Audio data too small to determine type (minimum 12 bytes)",
    );
  }

  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x41 &&
    data[10] === 0x56 &&
    data[11] === 0x45
  ) {
    return "audio/wav";
  }

  if (
    (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) ||
    (data[0] === 0xff &&
      (data[1] === 0xfb ||
        data[1] === 0xfa ||
        data[1] === 0xf3 ||
        data[1] === 0xf2))
  ) {
    return "audio/mp3";
  }

  if (
    data[0] === 0x46 &&
    data[1] === 0x4f &&
    data[2] === 0x52 &&
    data[3] === 0x4d &&
    data[8] === 0x41 &&
    data[9] === 0x49 &&
    data[10] === 0x46 &&
    data[11] === 0x46
  ) {
    return "audio/aiff";
  }

  if (
    data[0] === 0x4f &&
    data[1] === 0x67 &&
    data[2] === 0x67 &&
    data[3] === 0x53
  ) {
    return "audio/ogg";
  }

  if (
    data[0] === 0x66 &&
    data[1] === 0x4c &&
    data[2] === 0x61 &&
    data[3] === 0x43
  ) {
    return "audio/flac";
  }

  if (data[0] === 0xff && (data[1]! & 0xf0) === 0xf0) {
    return "audio/aac";
  }

  throw new Error("Unsupported audio type");
}

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]!);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create Audio from raw bytes. */
export function audioFromBytes(
  data: Uint8Array,
  maxSize = MAX_AUDIO_SIZE,
): Audio {
  if (data.length > maxSize) {
    throw new Error(
      `Audio size (${data.length} bytes) exceeds maximum (${maxSize} bytes)`,
    );
  }
  const mimeType = inferAudioType(data);
  const base64 = uint8ArrayToBase64(data);
  return {
    type: "audio",
    source: { type: "base64_audio_source", data: base64, mimeType },
  };
}
