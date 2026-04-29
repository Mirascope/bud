import {
  Identity,
  renderIdentity,
  type IdentityProfile,
  type IdentityService,
} from "@bud/identity";
import { Effect, Layer, Ref } from "effect";

export function makeIdentityMemory(
  initial: IdentityProfile = { assistantName: "Bud" },
): Effect.Effect<IdentityService> {
  return Effect.gen(function* () {
    const ref = yield* Ref.make<IdentityProfile>(initial);
    const get = Ref.get(ref);
    return {
      get,
      update: (patch) =>
        Ref.updateAndGet(ref, (current) => ({ ...current, ...patch })),
      render: get.pipe(Effect.map(renderIdentity)),
    };
  });
}

export const IdentityMemory = (
  initial?: IdentityProfile,
): Layer.Layer<Identity> => Layer.effect(Identity, makeIdentityMemory(initial));
