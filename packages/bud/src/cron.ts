import { Context, Effect, Layer, Ref } from "effect";

export interface CronTask {
  readonly id: string;
  readonly title: string;
  readonly schedule: string;
  readonly command: string;
  readonly createdAt: string;
  readonly cancelledAt?: string;
  readonly lastTriggeredAt?: string;
}

export interface CronSchedule {
  readonly title: string;
  readonly schedule: string;
  readonly command: string;
}

export interface CronService {
  readonly schedule: (task: CronSchedule) => Effect.Effect<CronTask>;
  readonly list: Effect.Effect<readonly CronTask[]>;
  readonly cancel: (id: string) => Effect.Effect<boolean>;
  readonly trigger: (id: string) => Effect.Effect<CronTask | null>;
}

export class Cron extends Context.Tag("@bud/bud/Cron")<Cron, CronService>() {
  static memory(
    options: { readonly now?: () => string } = {},
  ): Layer.Layer<Cron> {
    return Layer.effect(
      Cron,
      Effect.gen(function* () {
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
      }),
    );
  }
}
