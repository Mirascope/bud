import type { ProviderService } from "./provider.schemas.ts";
import { ProviderError } from "./provider.schemas.ts";
import { Context, Effect, Layer } from "effect";

export interface ProviderEntry {
  readonly scopes: string | string[];
  readonly provider: ProviderService;
}

export interface ProviderRegistryService {
  readonly resolve: (
    modelId: string,
  ) => Effect.Effect<ProviderService, ProviderError>;
}

export class ProviderRegistry extends Context.Tag("@bud/llm/ProviderRegistry")<
  ProviderRegistry,
  ProviderRegistryService
>() {
  static layer(
    entries: ReadonlyArray<ProviderEntry>,
  ): Layer.Layer<ProviderRegistry> {
    const prefixMap = new Map<string, ProviderService>();
    for (const entry of entries) {
      const scopes = Array.isArray(entry.scopes)
        ? entry.scopes
        : [entry.scopes];
      for (const scope of scopes) {
        prefixMap.set(scope, entry.provider);
      }
    }

    return Layer.succeed(ProviderRegistry, {
      resolve: (modelId: string) => {
        let bestScope: string | undefined;
        let bestLength = 0;

        for (const scope of prefixMap.keys()) {
          if (modelId.startsWith(scope) && scope.length > bestLength) {
            bestScope = scope;
            bestLength = scope.length;
          }
        }

        if (bestScope) {
          return Effect.succeed(prefixMap.get(bestScope)!);
        }
        return Effect.fail(
          new ProviderError({
            message: `No provider registered for model "${modelId}".`,
            providerId: "registry",
            kind: "invalid_request",
          }),
        );
      },
    });
  }
}
