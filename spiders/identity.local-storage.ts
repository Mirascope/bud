import {
  Identity,
  renderIdentity,
  type IdentityProfile,
  type IdentityService,
} from "@bud/identity";
import { ObjectStorage, type ObjectStorageService } from "@bud/object-storage";
import { Effect, Layer } from "effect";

export interface IdentityLocalStorageOptions {
  readonly namespace?: string;
  readonly initial?: IdentityProfile;
}

const JSON_CONTENT_TYPE = "application/json";

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function makeIdentityLocalStorage(
  objectStorage: ObjectStorageService,
  options: IdentityLocalStorageOptions = {},
): IdentityService {
  const namespace = options.namespace ?? "bud/identity";
  const initial = options.initial ?? { assistantName: "Bud" };
  const key = `${namespace}/profile.json`;

  const read = Effect.gen(function* () {
    const head = yield* objectStorage.headObject(key);
    if (!head) return initial;
    const object = yield* objectStorage.getObject(key);
    return parseJson<IdentityProfile>(object.body);
  }).pipe(Effect.orDie);

  const write = (profile: IdentityProfile) =>
    objectStorage
      .putObject({
        key,
        body: jsonBytes(profile),
        contentType: JSON_CONTENT_TYPE,
      })
      .pipe(Effect.as(profile), Effect.orDie);

  return {
    get: read,
    update: (patch) =>
      Effect.gen(function* () {
        const current = yield* read;
        return yield* write({ ...current, ...patch });
      }),
    render: read.pipe(Effect.map(renderIdentity)),
  };
}

export const IdentityLocalStorage = (
  options?: IdentityLocalStorageOptions,
): Layer.Layer<Identity, never, ObjectStorage> =>
  Layer.effect(
    Identity,
    Effect.map(ObjectStorage, (storage) =>
      makeIdentityLocalStorage(storage, options),
    ),
  );
