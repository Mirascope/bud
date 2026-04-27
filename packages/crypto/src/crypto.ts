import { Context, type Effect, Schema } from "effect";

export class CryptoError extends Schema.TaggedError<CryptoError>()(
  "CryptoError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface CryptoService {
  readonly sha256Hex: (input: string) => Effect.Effect<string, CryptoError>;
  readonly randomUUID: () => string;
}

export class Crypto extends Context.Tag("@bud/crypto/Crypto")<
  Crypto,
  CryptoService
>() {}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
