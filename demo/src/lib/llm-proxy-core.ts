import * as LLM from "@bud/llm";
import { Effect, Stream } from "effect";

type HostedProviderName = "anthropic" | "openai" | "google";

export interface HostedProviderAvailability {
  readonly anthropic: boolean;
  readonly openai: boolean;
  readonly google: boolean;
}

export interface HostedProviderStreamInput {
  readonly provider: HostedProviderName;
  readonly args: LLM.ProviderCallArgs;
}

interface HostedProviderStreamError {
  readonly message: string;
  readonly kind: LLM.ProviderErrorKind;
  readonly providerId: string;
  readonly statusCode?: number;
}

export function getHostedProviderAvailabilityValue(): HostedProviderAvailability {
  return {
    anthropic: hasProviderApiKey("anthropic"),
    openai: hasProviderApiKey("openai"),
    google: hasProviderApiKey("google"),
  };
}

export function handleHostedProviderStream(
  data: HostedProviderStreamInput,
): Response {
  const input = validateHostedProviderStreamInput(data);
  const provider = makeHostedProvider(input.provider);
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void Effect.runPromise(
        Stream.runForEach(provider.stream(input.args), (chunk) =>
          Effect.sync(() => {
            controller.enqueue(encoder.encode(encodeSse("chunk", chunk)));
          }),
        ),
      )
        .catch((error: unknown) => {
          const providerError = toProviderError(error, input.provider);
          controller.enqueue(
            encoder.encode(
              encodeSse("error", {
                message: providerError.message,
                kind: providerError.kind,
                providerId: providerError.providerId,
                statusCode: providerError.statusCode,
              } satisfies HostedProviderStreamError),
            ),
          );
        })
        .finally(() => controller.close());
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

function validateHostedProviderStreamInput(
  value: HostedProviderStreamInput,
): HostedProviderStreamInput {
  if (
    value?.provider !== "anthropic" &&
    value?.provider !== "openai" &&
    value?.provider !== "google"
  ) {
    throw new Error("Unsupported hosted provider.");
  }
  if (!value.args || typeof value.args.modelId !== "string") {
    throw new Error("Missing provider call arguments.");
  }
  return value;
}

function makeHostedProvider(provider: HostedProviderName): LLM.ProviderService {
  const apiKey = getProviderApiKey(provider);
  switch (provider) {
    case "anthropic":
      return LLM.makeAnthropicProvider({ apiKey });
    case "openai":
      return LLM.makeOpenAIProvider({ apiKey });
    case "google":
      return LLM.makeGoogleProvider({ apiKey });
  }
}

function getProviderApiKey(provider: HostedProviderName): string {
  const value = getProviderApiKeyValue(provider);
  if (value?.trim()) return value;
  throw new LLM.ProviderError({
    message: `Missing ${provider} API key on the dev server.`,
    providerId: provider,
    kind: "auth",
  });
}

function hasProviderApiKey(provider: HostedProviderName): boolean {
  return !!getProviderApiKeyValue(provider)?.trim();
}

function getProviderApiKeyValue(
  provider: HostedProviderName,
): string | undefined {
  const env =
    (
      globalThis as {
        Bun?: { env?: Record<string, string | undefined> };
        process?: { env?: Record<string, string | undefined> };
      }
    ).Bun?.env ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ??
    {};
  return provider === "anthropic"
    ? env.ANTHROPIC_API_KEY
    : provider === "openai"
      ? env.OPENAI_API_KEY
      : env.GOOGLE_API_KEY;
}

function encodeSse(event: string, data: unknown): string {
  const lines = JSON.stringify(data).split(/\r?\n/);
  return `event: ${event}\n${lines.map((line) => `data: ${line}`).join("\n")}\n\n`;
}

function toProviderError(
  error: unknown,
  provider: HostedProviderName,
): LLM.ProviderError {
  if (error instanceof LLM.ProviderError) return error;
  if (LLM.isProviderErrorLike(error)) {
    return new LLM.ProviderError({
      message: error.message,
      providerId: error.providerId ?? provider,
      kind: error.kind as LLM.ProviderErrorKind,
      statusCode: error.statusCode,
    });
  }
  return new LLM.ProviderError({
    message: error instanceof Error ? error.message : String(error),
    providerId: provider,
    kind: "unknown",
  });
}
