import { Pricing } from "./pricing.ts";
import { Layer } from "effect";

export const PricingDefault = Layer.succeed(Pricing, {
  llmCost: () => 0,
  toolCost: () => 0,
});
