import { AngelAdapter } from "./angel.js";
import { FyersAdapter } from "./fyers.js";
import type { BrokerAdapter } from "./types.js";

export function getAdapter(brokerName: string): BrokerAdapter {
  switch (brokerName) {
    case "angel_one": return new AngelAdapter();
    case "fyers":     return new FyersAdapter();
    default:
      throw new Error(`No adapter for broker: ${brokerName}`);
  }
}

export type { BrokerAdapter, BrokerCredentials } from "./types.js";
