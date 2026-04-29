import { Cron, type CronService, type CronTask } from "@bud/cron";
import { ObjectStorage, type ObjectStorageService } from "@bud/object-storage";
import { Effect, Layer } from "effect";

export interface CronLocalStorageOptions {
  readonly namespace?: string;
  readonly now?: () => string;
}

const JSON_CONTENT_TYPE = "application/json";

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function makeCronLocalStorage(
  objectStorage: ObjectStorageService,
  options: CronLocalStorageOptions = {},
): CronService {
  const namespace = options.namespace ?? "bud/cron";
  const now = options.now ?? (() => new Date().toISOString());
  const key = `${namespace}/tasks.json`;

  const readTasks = Effect.gen(function* () {
    const head = yield* objectStorage.headObject(key);
    if (!head) return [] as readonly CronTask[];
    const object = yield* objectStorage.getObject(key);
    return parseJson<readonly CronTask[]>(object.body);
  }).pipe(Effect.orDie);

  const writeTasks = (tasks: readonly CronTask[]) =>
    objectStorage
      .putObject({
        key,
        body: jsonBytes(tasks),
        contentType: JSON_CONTENT_TYPE,
      })
      .pipe(Effect.as(tasks), Effect.orDie);

  return {
    schedule: (task) =>
      Effect.gen(function* () {
        const tasks = yield* readTasks;
        const next = {
          id: `cron:${crypto.randomUUID()}`,
          title: task.title,
          schedule: task.schedule,
          command: task.command,
          createdAt: now(),
        } satisfies CronTask;
        yield* writeTasks([...tasks, next]);
        return next;
      }),
    list: readTasks,
    cancel: (id) =>
      Effect.gen(function* () {
        const tasks = yield* readTasks;
        let cancelled = false;
        const next = tasks.map((task) => {
          if (task.id !== id || task.cancelledAt) return task;
          cancelled = true;
          return { ...task, cancelledAt: now() };
        });
        yield* writeTasks(next);
        return cancelled;
      }),
    trigger: (id) =>
      Effect.gen(function* () {
        const tasks = yield* readTasks;
        let triggered: CronTask | null = null;
        const next = tasks.map((task) => {
          if (task.id !== id || task.cancelledAt) return task;
          triggered = { ...task, lastTriggeredAt: now() };
          return triggered;
        });
        yield* writeTasks(next);
        return triggered;
      }),
  } satisfies CronService;
}

export const CronLocalStorage = (
  options?: CronLocalStorageOptions,
): Layer.Layer<Cron, never, ObjectStorage> =>
  Layer.effect(
    Cron,
    Effect.map(ObjectStorage, (storage) =>
      makeCronLocalStorage(storage, options),
    ),
  );
