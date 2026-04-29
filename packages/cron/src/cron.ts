import { Context, type Effect } from "effect";

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

export class Cron extends Context.Tag("@bud/cron/Cron")<Cron, CronService>() {}
