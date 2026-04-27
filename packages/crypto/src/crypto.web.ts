import {
  Crypto,
  CryptoError,
  bytesToHex,
  type CryptoService,
} from "./crypto.ts";
import { Effect, Layer } from "effect";

export const WebCrypto = {
  make: (): CryptoService => ({
    randomUUID: () => {
      if (typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = bytesToHex(bytes);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    sha256Hex: (input) =>
      Effect.tryPromise({
        try: async () => {
          const bytes = new TextEncoder().encode(input);
          const digest = await globalThis.crypto.subtle.digest(
            "SHA-256",
            bytes,
          );
          return bytesToHex(new Uint8Array(digest));
        },
        catch: (cause) =>
          new CryptoError({
            message: "Unable to compute SHA-256 digest",
            cause,
          }),
      }),
  }),

  layer: (): Layer.Layer<Crypto> => Layer.succeed(Crypto, WebCrypto.make()),
};
