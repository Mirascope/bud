import { Context, type Effect, Schema } from "effect";

// ---------------------------------------------------------------------------
// Paths and files
// ---------------------------------------------------------------------------

export const WorkspacePath = Schema.String.pipe(
  Schema.filter((path) => !path.includes("\0"), {
    message: () => "Workspace paths cannot contain null bytes",
  }),
);
export type WorkspacePath = typeof WorkspacePath.Type;

export const FileEncoding = Schema.Literal("utf8", "base64");
export type FileEncoding = typeof FileEncoding.Type;

export const FileContent = Schema.Struct({
  data: Schema.String,
  encoding: FileEncoding,
});
export type FileContent = typeof FileContent.Type;

export const FileInfo = Schema.Struct({
  path: WorkspacePath,
  kind: Schema.Literal("file", "directory"),
  size: Schema.Number,
  updatedAt: Schema.String,
});
export type FileInfo = typeof FileInfo.Type;

export const DirectoryEntry = Schema.Struct({
  path: WorkspacePath,
  name: Schema.String,
  kind: Schema.Literal("file", "directory"),
  size: Schema.Number,
  updatedAt: Schema.String,
});
export type DirectoryEntry = typeof DirectoryEntry.Type;

export const ReadFileResponse = Schema.Struct({
  path: WorkspacePath,
  content: FileContent,
  size: Schema.Number,
  updatedAt: Schema.String,
});
export type ReadFileResponse = typeof ReadFileResponse.Type;

export const ReadFileOptions = Schema.Struct({
  encoding: Schema.optional(FileEncoding),
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
});
export type ReadFileOptions = typeof ReadFileOptions.Type;

export const WriteFileOptions = Schema.Struct({
  path: WorkspacePath,
  content: FileContent,
  createParents: Schema.optional(Schema.Boolean),
});
export type WriteFileOptions = typeof WriteFileOptions.Type;

export const TextEdit = Schema.Struct({
  oldText: Schema.String,
  newText: Schema.String,
  replaceAll: Schema.optional(Schema.Boolean),
});
export type TextEdit = typeof TextEdit.Type;

export const EditFileOptions = Schema.Struct({
  path: WorkspacePath,
  edits: Schema.NonEmptyArray(TextEdit),
});
export type EditFileOptions = typeof EditFileOptions.Type;

export const EditFileResponse = Schema.Struct({
  path: WorkspacePath,
  applied: Schema.Number,
  content: FileContent,
  size: Schema.Number,
  updatedAt: Schema.String,
});
export type EditFileResponse = typeof EditFileResponse.Type;

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export const TerminalId = Schema.String;
export type TerminalId = typeof TerminalId.Type;

export const TerminalStatus = Schema.Literal("running", "exited", "killed");
export type TerminalStatus = typeof TerminalStatus.Type;

export const TerminalStartOptions = Schema.Struct({
  shell: Schema.optional(Schema.String),
  cwd: Schema.optional(WorkspacePath),
  env: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
  cols: Schema.optional(Schema.Number),
  rows: Schema.optional(Schema.Number),
});
export type TerminalStartOptions = typeof TerminalStartOptions.Type;

export const TerminalSession = Schema.Struct({
  id: TerminalId,
  shell: Schema.String,
  cwd: WorkspacePath,
  status: TerminalStatus,
  startedAt: Schema.String,
  exitedAt: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type TerminalSession = typeof TerminalSession.Type;

export const TerminalOutput = Schema.Struct({
  terminalId: TerminalId,
  output: Schema.String,
  status: TerminalStatus,
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type TerminalOutput = typeof TerminalOutput.Type;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ComputerErrorKind = Schema.Literal(
  "not_found",
  "already_exists",
  "invalid_path",
  "conflict",
  "permission_denied",
  "terminal_unavailable",
  "unsupported",
  "unknown",
);
export type ComputerErrorKind = typeof ComputerErrorKind.Type;

export class ComputerError extends Schema.TaggedError<ComputerError>()(
  "ComputerError",
  {
    message: Schema.String,
    kind: ComputerErrorKind,
    path: Schema.optional(Schema.String),
    terminalId: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export function makeComputerError(options: {
  readonly message: string;
  readonly kind?: ComputerErrorKind;
  readonly path?: string;
  readonly terminalId?: string;
  readonly cause?: unknown;
}): ComputerError {
  return new ComputerError({
    kind: "unknown",
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ComputerService {
  readonly list: (
    path?: WorkspacePath,
  ) => Effect.Effect<DirectoryEntry[], ComputerError>;

  readonly stat: (
    path: WorkspacePath,
  ) => Effect.Effect<FileInfo | null, ComputerError>;

  readonly read: (
    path: WorkspacePath,
    options?: ReadFileOptions,
  ) => Effect.Effect<ReadFileResponse, ComputerError>;

  readonly write: (
    options: WriteFileOptions,
  ) => Effect.Effect<FileInfo, ComputerError>;

  readonly edit: (
    options: EditFileOptions,
  ) => Effect.Effect<EditFileResponse, ComputerError>;

  readonly remove: (path: WorkspacePath) => Effect.Effect<void, ComputerError>;

  readonly startTerminal: (
    options?: TerminalStartOptions,
  ) => Effect.Effect<TerminalSession, ComputerError>;

  readonly writeTerminal: (
    terminalId: TerminalId,
    input: string,
  ) => Effect.Effect<void, ComputerError>;

  readonly readTerminal: (
    terminalId: TerminalId,
  ) => Effect.Effect<TerminalOutput, ComputerError>;

  readonly killTerminal: (
    terminalId: TerminalId,
  ) => Effect.Effect<void, ComputerError>;
}

export class Computer extends Context.Tag("@bud/computer/Computer")<
  Computer,
  ComputerService
>() {}
