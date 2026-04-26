import type { PricingService } from "./pricing.ts";
import { Pricing } from "./pricing.ts";
import { Layer } from "effect";

export const zeroPricing: PricingService = {
  llmCost: () => 0,
  toolCost: () => 0,
};

export const PricingZero = Layer.succeed(Pricing, zeroPricing);
export const PricingDefault = PricingZero;
