import type { FileSystemTree } from "@webcontainer/api";

export interface WorkspaceMetadata {
  readonly updatedAtByPath: Readonly<Record<string, string>>;
}

export interface WorkspaceSnapshot {
  readonly id: string;
  readonly tree: FileSystemTree;
  readonly metadata: WorkspaceMetadata;
  readonly updatedAt: string;
}

export interface IndexedDBWorkspaceStoreOptions {
  readonly databaseName?: string;
  readonly storeName?: string;
  readonly workspaceId?: string;
  readonly now?: () => string;
}

export interface WorkspaceStore {
  readonly load: () => Promise<WorkspaceSnapshot | null>;
  readonly save: (
    tree: FileSystemTree,
    metadata: WorkspaceMetadata,
  ) => Promise<WorkspaceSnapshot>;
}

const DEFAULT_DATABASE_NAME = "bud-computer";
const DEFAULT_STORE_NAME = "workspaces";
const DEFAULT_WORKSPACE_ID = "default";

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
        database.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const IndexedDBWorkspaceStore = {
  make: (options: IndexedDBWorkspaceStoreOptions = {}): WorkspaceStore => {
    const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    const storeName = options.storeName ?? DEFAULT_STORE_NAME;
    const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const now = options.now ?? (() => new Date().toISOString());
    const database = openDatabase(databaseName, storeName);

    return {
      load: async () => {
        const db = await database;
        const transaction = db.transaction(storeName, "readonly");
        const snapshot = await requestToPromise<WorkspaceSnapshot | undefined>(
          transaction.objectStore(storeName).get(workspaceId),
        );
        await transactionDone(transaction);
        return snapshot ?? null;
      },

      save: async (tree, metadata) => {
        const db = await database;
        const snapshot: WorkspaceSnapshot = {
          id: workspaceId,
          tree,
          metadata,
          updatedAt: now(),
        };
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(snapshot);
        await transactionDone(transaction);
        return snapshot;
      },
    };
  },
};
