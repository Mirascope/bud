/**
 * Image generation service.
 *
 * Unified abstraction over image-generation models. Callers pass a multi-part
 * prompt with interleaved text and reference images, and receive one generated
 * image plus optional text notes.
 */
import type { Base64Image, Image } from "../content/image.ts";
import type { Text } from "../content/text.ts";
import { Context, type Effect, Schema } from "effect";

// ---------------------------------------------------------------------------
// Call args
// ---------------------------------------------------------------------------

export type ImageGenPart = Text | Image;

export interface ImageGeneratorCallArgs {
  readonly parts: readonly ImageGenPart[];
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ImageGenerationResult {
  readonly image: Base64Image;
  readonly text?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ImageGenerationErrorKind = Schema.Literal(
  "rate_limit",
  "auth",
  "invalid_request",
  "server_error",
  "no_image",
  "unknown",
);
export type ImageGenerationErrorKind = typeof ImageGenerationErrorKind.Type;

export class ImageGenerationError extends Schema.TaggedError<ImageGenerationError>()(
  "ImageGenerationError",
  {
    message: Schema.String,
    providerId: Schema.String,
    kind: ImageGenerationErrorKind,
    statusCode: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ImageGenerator {
  readonly id: string;
  readonly generate: (
    args: ImageGeneratorCallArgs,
  ) => Effect.Effect<ImageGenerationResult, ImageGenerationError>;
}

export class ImageGeneratorTag extends Context.Tag("@bud/llm/ImageGenerator")<
  ImageGeneratorTag,
  ImageGenerator
>() {}
