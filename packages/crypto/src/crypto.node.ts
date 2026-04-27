import {
  bytesToHex,
  Crypto,
  CryptoError,
  type CryptoService,
} from "./crypto.ts";
import { Effect, Layer } from "effect";
import { createHash, randomUUID } from "node:crypto";

export const NodeCrypto = {
  make: (): CryptoService => ({
    randomUUID,
    sha256Hex: (input) =>
      Effect.try({
        try: () => bytesToHex(createHash("sha256").update(input).digest()),
        catch: (cause) =>
          new CryptoError({
            message: "Unable to compute SHA-256 digest",
            cause,
          }),
      }),
  }),

  layer: (): Layer.Layer<Crypto> => Layer.succeed(Crypto, NodeCrypto.make()),
};
