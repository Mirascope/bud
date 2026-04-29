import {
  getHostedProviderAvailabilityValue,
  handleHostedProviderStream,
  type HostedProviderAvailability,
  type HostedProviderStreamInput,
} from "./llm-proxy-core.ts";
import { createServerFn } from "@tanstack/react-start";

export type { HostedProviderAvailability, HostedProviderStreamInput };

export const streamHostedProvider = createServerFn({ method: "POST" })
  .inputValidator((value: HostedProviderStreamInput) => value)
  .handler(({ data }) => handleHostedProviderStream(data));

export const getHostedProviderAvailability = createServerFn({
  method: "GET",
}).handler(getHostedProviderAvailabilityValue);
