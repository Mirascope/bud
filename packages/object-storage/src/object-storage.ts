import { Context, Effect, Schema } from "effect";

export class ObjectStorageError extends Schema.TaggedError<ObjectStorageError>()(
  "ObjectStorageError",
  {
    message: Schema.String,
    key: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface StoredObject {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface PutObjectOptions {
  readonly key?: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface GetObjectResponse extends StoredObject {
  readonly body: Uint8Array;
}

export interface ObjectStorageService {
  readonly putObject: (
    options: PutObjectOptions,
  ) => Effect.Effect<StoredObject, ObjectStorageError>;
  readonly getObject: (
    key: string,
  ) => Effect.Effect<GetObjectResponse, ObjectStorageError>;
  readonly headObject: (
    key: string,
  ) => Effect.Effect<StoredObject | null, ObjectStorageError>;
  readonly deleteObject: (
    key: string,
  ) => Effect.Effect<void, ObjectStorageError>;
}

export class ObjectStorage extends Context.Tag(
  "@bud/object-storage/ObjectStorage",
)<ObjectStorage, ObjectStorageService>() {}

export function makeObjectStorageError(
  message: string,
  key?: string,
  cause?: unknown,
): ObjectStorageError {
  return new ObjectStorageError({ message, key, cause });
}
