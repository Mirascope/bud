import { Gateway, type GatewayEvent, type GatewayRun } from "@bud/gateway";
import { Effect, Layer, Ref, Stream } from "effect";

export const GatewaySpider = (): Layer.Layer<Gateway> =>
  Layer.effect(
    Gateway,
    Effect.gen(function* () {
      const events = yield* Ref.make<readonly GatewayEvent[]>([]);
      return {
        enqueue: (event) =>
          Effect.gen(function* () {
            yield* Ref.update(events, (current) => [...current, event]);
            return { id: `spider:${crypto.randomUUID()}` } satisfies GatewayRun;
          }),
        run: () => Effect.void,
        stream: () =>
          Stream.fromIterableEffect(
            Ref.get(events),
          ) as Stream.Stream<GatewayEvent>,
      };
    }),
  );
