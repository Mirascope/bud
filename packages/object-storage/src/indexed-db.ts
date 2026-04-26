import {
  makeObjectStorageError,
  ObjectStorage,
  ObjectStorageError,
  type GetObjectResponse,
  type ObjectStorageService,
  type StoredObject,
} from "./object-storage.ts";
import { Effect, Layer } from "effect";

interface IndexedDBObject extends StoredObject {
  readonly body: Uint8Array;
}

export interface IndexedDBOptions {
  readonly databaseName?: string;
  readonly storeName?: string;
  readonly now?: () => string;
  readonly keyPrefix?: string;
}

const DEFAULT_DATABASE_NAME = "bud-object-storage";
const DEFAULT_STORE_NAME = "objects";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(
  databaseName: string,
  storeName: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function defaultKey(): string {
  return crypto.randomUUID();
}

async function getStoredObject(
  database: Promise<IDBDatabase>,
  storeName: string,
  key: string,
): Promise<IndexedDBObject | undefined> {
  const db = await database;
  const transaction = db.transaction(storeName, "readonly");
  const object = await requestToPromise<IndexedDBObject | undefined>(
    transaction.objectStore(storeName).get(key),
  );
  await transactionDone(transaction);
  return object;
}

export const IndexedDB = {
  make: (options: IndexedDBOptions = {}): ObjectStorageService => {
    const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    const storeName = options.storeName ?? DEFAULT_STORE_NAME;
    const now = options.now ?? (() => new Date().toISOString());
    const keyPrefix = options.keyPrefix ?? "object";
    const database = openDatabase(databaseName, storeName);

    return {
      putObject: (options) =>
        Effect.tryPromise({
          try: async () => {
            const db = await database;
            const timestamp = now();
            const key = options.key ?? `${keyPrefix}/${defaultKey()}`;
            const existing = await getStoredObject(database, storeName, key);
            const object: IndexedDBObject = {
              key,
              body: new Uint8Array(options.body),
              contentType: options.contentType,
              size: options.body.byteLength,
              createdAt: existing?.createdAt ?? timestamp,
              updatedAt: timestamp,
              metadata: options.metadata ?? {},
            };

            const transaction = db.transaction(storeName, "readwrite");
            transaction.objectStore(storeName).put(object);
            await transactionDone(transaction);

            const { body: _, ...metadata } = object;
            return metadata;
          },
          catch: (cause) =>
            makeObjectStorageError("Unable to write object", undefined, cause),
        }),

      getObject: (key) =>
        Effect.tryPromise({
          try: async (): Promise<GetObjectResponse> => {
            const object = await getStoredObject(database, storeName, key);
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
        Effect.tryPromise({
          try: async (): Promise<StoredObject | null> => {
            const object = await getStoredObject(database, storeName, key);
            if (!object) return null;
            const { body: _, ...metadata } = object;
            return metadata;
          },
          catch: (cause) =>
            makeObjectStorageError("Unable to inspect object", key, cause),
        }),

      deleteObject: (key) =>
        Effect.tryPromise({
          try: async () => {
            const db = await database;
            const transaction = db.transaction(storeName, "readwrite");
            transaction.objectStore(storeName).delete(key);
            await transactionDone(transaction);
          },
          catch: (cause) =>
            makeObjectStorageError("Unable to delete object", key, cause),
        }),
    };
  },

  layer: (options?: IndexedDBOptions): Layer.Layer<ObjectStorage> =>
    Layer.succeed(ObjectStorage, IndexedDB.make(options)),
};
