import { Context, type Effect } from "effect";

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

export class Identity extends Context.Tag("@bud/identity/Identity")<
  Identity,
  IdentityService
>() {}

export function renderIdentity(profile: IdentityProfile): string {
  const lines = [`Assistant: ${profile.assistantName}`];
  if (profile.userName) lines.push(`User: ${profile.userName}`);
  if (profile.summary) lines.push(profile.summary);
  return lines.join("\n");
}
