import {
  makeObjectStorageError,
  ObjectStorage,
  ObjectStorageError,
  type GetObjectResponse,
  type ObjectStorageService,
  type StoredObject,
} from "./object-storage.ts";
import { Effect, Layer } from "effect";

interface StoredInMemoryObject extends StoredObject {
  readonly body: Uint8Array;
}

export interface InMemoryOptions {
  readonly now?: () => string;
  readonly keyPrefix?: string;
}

function defaultKey(): string {
  return crypto.randomUUID();
}

export const InMemory = {
  make: (options: InMemoryOptions = {}): ObjectStorageService => {
    const now = options.now ?? (() => new Date().toISOString());
    const keyPrefix = options.keyPrefix ?? "object";
    const objects = new Map<string, StoredInMemoryObject>();

    return {
      putObject: (options) =>
        Effect.sync(() => {
          const timestamp = now();
          const key = options.key ?? `${keyPrefix}/${defaultKey()}`;
          const existing = objects.get(key);
          const object: StoredInMemoryObject = {
            key,
            body: new Uint8Array(options.body),
            contentType: options.contentType,
            size: options.body.byteLength,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
            metadata: options.metadata ?? {},
          };
          objects.set(key, object);

          const { body: _, ...metadata } = object;
          return metadata;
        }),

      getObject: (key) =>
        Effect.try({
          try: (): GetObjectResponse => {
            const object = objects.get(key);
            if (!object) {
              throw makeObjectStorageError("Object not found", key);
            }
            return { ...object, body: new Uint8Array(object.body) };
          },
          catch: (cause) =>
            cause instanceof ObjectStorageError
              ? cause
              : makeObjectStorageError("Unable to read object", key, cause),
        }),

      headObject: (key) =>
        Effect.sync(() => {
          const object = objects.get(key);
          if (!object) return null;
          const { body: _, ...metadata } = object;
          return metadata;
        }),

      deleteObject: (key) =>
        Effect.sync(() => {
          objects.delete(key);
        }),
    };
  },

  layer: (options?: InMemoryOptions): Layer.Layer<ObjectStorage> =>
    Layer.succeed(ObjectStorage, InMemory.make(options)),
};
