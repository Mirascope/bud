import {
  getHostedProviderAvailabilityValue,
  handleHostedProviderStream,
  type HostedProviderStreamInput,
} from "@demo/lib/llm-proxy-core";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/llm-proxy")({
  server: {
    handlers: {
      GET: async () => Response.json(getHostedProviderAvailabilityValue()),
      POST: async ({ request }) => {
        const data = (await request.json()) as HostedProviderStreamInput;
        return handleHostedProviderStream(data);
      },
    },
  },
});
