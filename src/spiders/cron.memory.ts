import { Cron, type CronService, type CronTask } from "@bud/cron";
import { Effect, Layer, Ref } from "effect";

export interface CronMemoryOptions {
  readonly now?: () => string;
}

export function makeCronMemory(
  options: CronMemoryOptions = {},
): Effect.Effect<CronService> {
  return Effect.gen(function* () {
    const now = options.now ?? (() => new Date().toISOString());
    const ref = yield* Ref.make<readonly CronTask[]>([]);

    return {
      schedule: (task) =>
        Ref.updateAndGet(ref, (tasks) => [
          ...tasks,
          {
            id: `cron:${crypto.randomUUID()}`,
            title: task.title,
            schedule: task.schedule,
            command: task.command,
            createdAt: now(),
          },
        ]).pipe(Effect.map((tasks) => tasks.at(-1)!)),
      list: Ref.get(ref),
      cancel: (id) =>
        Ref.modify(ref, (tasks) => {
          let cancelled = false;
          const next = tasks.map((task) => {
            if (task.id !== id || task.cancelledAt) return task;
            cancelled = true;
            return { ...task, cancelledAt: now() };
          });
          return [cancelled, next];
        }),
      trigger: (id) =>
        Ref.modify(ref, (tasks) => {
          let triggered: CronTask | null = null;
          const next = tasks.map((task) => {
            if (task.id !== id || task.cancelledAt) return task;
            triggered = { ...task, lastTriggeredAt: now() };
            return triggered;
          });
          return [triggered, next];
        }),
    };
  });
}

export const CronMemory = (options?: CronMemoryOptions): Layer.Layer<Cron> =>
  Layer.effect(Cron, makeCronMemory(options));
