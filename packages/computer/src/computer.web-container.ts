import {
  Computer,
  ComputerError,
  makeComputerError,
  type ComputerService,
  type DirectoryEntry,
  type EditFileOptions,
  type EditFileResponse,
  type FileContent,
  type FileInfo,
  type ReadFileOptions,
  type ReadFileResponse,
  type TerminalSession,
  type TerminalStartOptions,
  type TerminalStatus,
  type WriteFileOptions,
} from "./computer.ts";
import {
  IndexedDBWorkspaceStore,
  type WorkspaceMetadata,
  type WorkspaceStore,
} from "./workspace-store.indexed-db.ts";
import { WebContainer, type FileSystemTree } from "@webcontainer/api";
import { Effect, Layer } from "effect";

export interface WebContainerComputerOptions {
  readonly boot?: Parameters<typeof WebContainer.boot>[0];
  readonly store?: WorkspaceStore;
  readonly now?: () => string;
  readonly bootTimeoutMs?: number;
}

interface TerminalState {
  session: TerminalSession;
  process: Awaited<ReturnType<WebContainer["spawn"]>>;
  writer: WritableStreamDefaultWriter<string>;
  outputBuffer: string;
}

interface Runtime {
  readonly container: WebContainer;
  readonly terminalStateById: Map<string, TerminalState>;
  readonly metadata: { updatedAtByPath: Record<string, string> };
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function normalizePath(path?: string): string {
  const normalized = (path ?? ".").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized === ".") return ".";
  const segments = normalized.split("/").filter((segment) => segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw makeComputerError({
      message: "Workspace paths cannot escape the workspace",
      kind: "invalid_path",
      path,
    });
  }
  return segments.join("/");
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

function decodeContent(content: FileContent): string | Uint8Array {
  if (content.encoding === "base64") {
    return Uint8Array.from(atob(content.data), (char) => char.charCodeAt(0));
  }
  return content.data;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function normalizeMetadata(metadata?: WorkspaceMetadata): {
  updatedAtByPath: Record<string, string>;
} {
  return { updatedAtByPath: { ...(metadata?.updatedAtByPath ?? {}) } };
}

function fileSystemError(
  message: string,
  path: string | undefined,
  cause: unknown,
): ComputerError {
  if (cause instanceof Error && cause.message.includes("ENOENT")) {
    return makeComputerError({ message, kind: "not_found", path, cause });
  }
  return makeComputerError({ message, path, cause });
}

async function readFileBytes(
  container: WebContainer,
  path: string,
): Promise<Uint8Array> {
  const data = await container.fs.readFile(path);
  return data instanceof Uint8Array ? data : textEncoder.encode(data);
}

async function fileInfo(
  container: WebContainer,
  metadata: Runtime["metadata"],
  path: string,
  now: () => string,
): Promise<FileInfo | null> {
  try {
    const bytes = await readFileBytes(container, path);
    return {
      path,
      kind: "file",
      size: bytes.byteLength,
      updatedAt: metadata.updatedAtByPath[path] ?? now(),
    };
  } catch {
    try {
      await container.fs.readdir(path);
      return {
        path,
        kind: "directory",
        size: 0,
        updatedAt: metadata.updatedAtByPath[path] ?? now(),
      };
    } catch {
      return null;
    }
  }
}

function walkTree(
  tree: FileSystemTree,
  visit: (path: string, kind: "file" | "directory") => void,
  prefix = "",
): void {
  for (const [name, node] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${name}` : name;
    if ("directory" in node) {
      visit(path, "directory");
      walkTree(node.directory, visit, path);
    } else {
      visit(path, "file");
    }
  }
}

function touchKnownPaths(
  tree: FileSystemTree,
  metadata: Runtime["metadata"],
  timestamp: string,
): void {
  walkTree(tree, (path) => {
    metadata.updatedAtByPath[path] = timestamp;
  });
}

export const WebContainerComputer = {
  make: (options: WebContainerComputerOptions = {}): ComputerService => {
    const store = options.store ?? IndexedDBWorkspaceStore.make();
    const now = options.now ?? (() => new Date().toISOString());
    const bootTimeoutMs = options.bootTimeoutMs ?? 15_000;
    let runtime: Promise<Runtime> | undefined;
    let terminalSequence = 0;

    const getRuntime = async (): Promise<Runtime> => {
      runtime ??= (async () => {
        if (
          typeof globalThis.crossOriginIsolated === "boolean" &&
          !globalThis.crossOriginIsolated
        ) {
          throw makeComputerError({
            message:
              "Browser computer requires cross-origin isolation. Try this demo in Chrome directly, or use a hosted computer implementation.",
            kind: "terminal_unavailable",
          });
        }
        const [container, snapshot] = await Promise.all([
          withTimeout(
            WebContainer.boot(options.boot),
            bootTimeoutMs,
            "Timed out starting browser computer",
          ),
          store.load(),
        ]);
        const metadata = normalizeMetadata(snapshot?.metadata);
        if (snapshot?.tree) {
          await container.mount(snapshot.tree);
        }
        return {
          container,
          terminalStateById: new Map(),
          metadata,
        };
      })();
      return runtime;
    };

    const persist = async (runtime: Runtime): Promise<void> => {
      const tree = await runtime.container.export(".", { format: "json" });
      await store.save(tree, runtime.metadata);
    };

    const syncAfterProcess = async (runtime: Runtime): Promise<void> => {
      const tree = await runtime.container.export(".", { format: "json" });
      touchKnownPaths(tree, runtime.metadata, now());
      await store.save(tree, runtime.metadata);
    };

    return {
      list: (path) =>
        Effect.tryPromise({
          try: async () => {
            const runtime = await getRuntime();
            const directory = normalizePath(path);
            const entries = await runtime.container.fs.readdir(directory, {
              withFileTypes: true,
            });
            const results: DirectoryEntry[] = [];
            for (const entry of entries) {
              const childPath =
                directory === "." ? entry.name : `${directory}/${entry.name}`;
              const info = entry.isDirectory()
                ? ({
                    path: childPath,
                    kind: "directory" as const,
                    size: 0,
                    updatedAt:
                      runtime.metadata.updatedAtByPath[childPath] ?? now(),
                  } satisfies FileInfo)
                : await fileInfo(
                    runtime.container,
                    runtime.metadata,
                    childPath,
                    now,
                  );
              if (info) {
                results.push({
                  ...info,
                  name: entry.name,
                });
              }
            }
            return results;
          },
          catch: (cause) =>
            fileSystemError("Unable to list directory", path, cause),
        }),

      stat: (path) =>
        Effect.tryPromise({
          try: async () => {
            const runtime = await getRuntime();
            return fileInfo(
              runtime.container,
              runtime.metadata,
              normalizePath(path),
              now,
            );
          },
          catch: (cause) =>
            fileSystemError("Unable to inspect path", path, cause),
        }),

      read: (path, options: ReadFileOptions = {}) =>
        Effect.tryPromise({
          try: async (): Promise<ReadFileResponse> => {
            const runtime = await getRuntime();
            const normalizedPath = normalizePath(path);
            const bytes = await readFileBytes(
              runtime.container,
              normalizedPath,
            );
            let data =
              options.encoding === "base64"
                ? encodeBase64(bytes)
                : textDecoder.decode(bytes);

            if (
              options.encoding !== "base64" &&
              (options.offset !== undefined || options.limit !== undefined)
            ) {
              const offset = Math.max(1, options.offset ?? 1);
              const limit = options.limit ?? Number.POSITIVE_INFINITY;
              data = data
                .split("\n")
                .slice(offset - 1, offset - 1 + limit)
                .join("\n");
            }

            return {
              path: normalizedPath,
              content: {
                data,
                encoding: options.encoding ?? "utf8",
              },
              size: bytes.byteLength,
              updatedAt:
                runtime.metadata.updatedAtByPath[normalizedPath] ?? now(),
            };
          },
          catch: (cause) => fileSystemError("Unable to read file", path, cause),
        }),

      write: (options: WriteFileOptions) =>
        Effect.tryPromise({
          try: async () => {
            const runtime = await getRuntime();
            const path = normalizePath(options.path);
            if (options.createParents) {
              await runtime.container.fs.mkdir(parentPath(path), {
                recursive: true,
              });
            }
            const body = decodeContent(options.content);
            await runtime.container.fs.writeFile(path, body);
            runtime.metadata.updatedAtByPath[path] = now();
            await persist(runtime);
            const info = await fileInfo(
              runtime.container,
              runtime.metadata,
              path,
              now,
            );
            if (!info) {
              throw makeComputerError({
                message: "File was not written",
                kind: "unknown",
                path,
              });
            }
            return info;
          },
          catch: (cause) =>
            fileSystemError("Unable to write file", options.path, cause),
        }),

      edit: (options: EditFileOptions) =>
        Effect.tryPromise({
          try: async (): Promise<EditFileResponse> => {
            const runtime = await getRuntime();
            const path = normalizePath(options.path);
            let content = textDecoder.decode(
              await readFileBytes(runtime.container, path),
            );
            let applied = 0;

            for (const edit of options.edits) {
              const matches = content.split(edit.oldText).length - 1;
              if (matches === 0) {
                throw makeComputerError({
                  message: "Text not found",
                  kind: "conflict",
                  path,
                });
              }
              if (matches > 1 && !edit.replaceAll) {
                throw makeComputerError({
                  message: "Text matched more than once",
                  kind: "conflict",
                  path,
                });
              }
              content = edit.replaceAll
                ? content.split(edit.oldText).join(edit.newText)
                : content.replace(edit.oldText, edit.newText);
              applied += edit.replaceAll ? matches : 1;
            }

            await runtime.container.fs.writeFile(path, content);
            runtime.metadata.updatedAtByPath[path] = now();
            await persist(runtime);

            return {
              path,
              applied,
              content: { data: content, encoding: "utf8" },
              size: textEncoder.encode(content).byteLength,
              updatedAt: runtime.metadata.updatedAtByPath[path] ?? now(),
            };
          },
          catch: (cause) =>
            cause instanceof ComputerError
              ? cause
              : fileSystemError("Unable to edit file", options.path, cause),
        }),

      remove: (path) =>
        Effect.tryPromise({
          try: async () => {
            const runtime = await getRuntime();
            const normalizedPath = normalizePath(path);
            await runtime.container.fs.rm(normalizedPath, {
              force: true,
              recursive: true,
            });
            delete runtime.metadata.updatedAtByPath[normalizedPath];
            await persist(runtime);
          },
          catch: (cause) =>
            fileSystemError("Unable to remove path", path, cause),
        }),

      startTerminal: (options: TerminalStartOptions = {}) =>
        Effect.tryPromise({
          try: async () => {
            const runtime = await getRuntime();
            const id = `webcontainer-terminal-${++terminalSequence}`;
            const shell = options.shell ?? "jsh";
            const cwd = normalizePath(options.cwd);
            const process = await runtime.container.spawn(shell, [], {
              cwd,
              env: options.env,
              terminal: {
                cols: options.cols ?? 80,
                rows: options.rows ?? 24,
              },
            });
            const session: TerminalSession = {
              id,
              shell,
              cwd,
              status: "running",
              startedAt: now(),
            };
            const state: TerminalState = {
              session,
              process,
              writer: process.input.getWriter(),
              outputBuffer: "",
            };
            runtime.terminalStateById.set(id, state);

            void process.output.pipeTo(
              new WritableStream<string>({
                write: (chunk) => {
                  state.outputBuffer += chunk;
                },
              }),
            );

            void process.exit.then(async (exitCode) => {
              state.session = {
                ...state.session,
                status: "exited",
                exitedAt: now(),
                exitCode,
              };
              await syncAfterProcess(runtime);
            });

            return session;
          },
          catch: (cause) =>
            makeComputerError({
              message: "Unable to start terminal",
              kind: "terminal_unavailable",
              cause,
            }),
        }),

      writeTerminal: (terminalId, input) =>
        Effect.tryPromise({
          try: async () => {
            const runtime = await getRuntime();
            const state = runtime.terminalStateById.get(terminalId);
            if (!state) {
              throw makeComputerError({
                message: "Terminal not found",
                kind: "not_found",
                terminalId,
              });
            }
            await state.writer.write(input);
          },
          catch: (cause) =>
            makeComputerError({
              message: "Unable to write terminal input",
              kind: "terminal_unavailable",
              terminalId,
              cause,
            }),
        }),

      readTerminal: (terminalId) =>
        Effect.tryPromise({
          try: async () => {
            const runtime = await getRuntime();
            const state = runtime.terminalStateById.get(terminalId);
            if (!state) {
              throw makeComputerError({
                message: "Terminal not found",
                kind: "not_found",
                terminalId,
              });
            }
            const output = state.outputBuffer;
            state.outputBuffer = "";
            return {
              terminalId,
              output,
              status: state.session.status as TerminalStatus,
              exitCode: state.session.exitCode,
            };
          },
          catch: (cause) =>
            makeComputerError({
              message: "Unable to read terminal output",
              kind: "terminal_unavailable",
              terminalId,
              cause,
            }),
        }),

      killTerminal: (terminalId) =>
        Effect.tryPromise({
          try: async () => {
            const runtime = await getRuntime();
            const state = runtime.terminalStateById.get(terminalId);
            if (!state) return;
            state.process.kill();
            state.session = {
              ...state.session,
              status: "killed",
              exitedAt: now(),
              exitCode: null,
            };
            await syncAfterProcess(runtime);
          },
          catch: (cause) =>
            makeComputerError({
              message: "Unable to kill terminal",
              kind: "terminal_unavailable",
              terminalId,
              cause,
            }),
        }),
    };
  },

  layer: (options?: WebContainerComputerOptions): Layer.Layer<Computer> =>
    Layer.succeed(Computer, WebContainerComputer.make(options)),
};

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
