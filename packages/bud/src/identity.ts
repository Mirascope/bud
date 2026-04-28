import { Context, Effect, Layer, Ref } from "effect";

export interface IdentityProfile {
  readonly assistantName: string;
  readonly userName?: string;
  readonly summary?: string;
}

export interface IdentityService {
  readonly get: Effect.Effect<IdentityProfile>;
  readonly update: (
    patch: Partial<IdentityProfile>,
  ) => Effect.Effect<IdentityProfile>;
  readonly render: Effect.Effect<string>;
}

export class Identity extends Context.Tag("@bud/bud/Identity")<
  Identity,
  IdentityService
>() {
  static memory(
    initial: IdentityProfile = { assistantName: "Bud" },
  ): Layer.Layer<Identity> {
    return Layer.effect(
      Identity,
      Effect.gen(function* () {
        const ref = yield* Ref.make<IdentityProfile>(initial);
        const get = Ref.get(ref);
        return {
          get,
          update: (patch) =>
            Ref.updateAndGet(ref, (current) => ({ ...current, ...patch })),
          render: get.pipe(Effect.map(renderIdentity)),
        };
      }),
    );
  }
}

function renderIdentity(profile: IdentityProfile): string {
  const lines = [`Assistant: ${profile.assistantName}`];
  if (profile.userName) lines.push(`User: ${profile.userName}`);
  if (profile.summary) lines.push(profile.summary);
  return lines.join("\n");
}
