import { Context, Effect, Stream } from "effect";

export interface GatewayEvent {
  readonly type: string;
  readonly payload?: unknown;
}

export interface GatewayRun {
  readonly id: string;
}

export interface GatewayService {
  readonly enqueue: (event: GatewayEvent) => Effect.Effect<GatewayRun, never>;
  readonly run: (runId: string) => Effect.Effect<void, never>;
  readonly stream: (runId: string) => Stream.Stream<GatewayEvent>;
}

export class Gateway extends Context.Tag("@bud/gateway/Gateway")<
  Gateway,
  GatewayService
>() {}
