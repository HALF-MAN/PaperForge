import { BitgetPublicAdapter } from "./bitget-public-adapter";
import { MockExchangeAdapter } from "./mock-adapter";
import type { ExchangeAdapter } from "./types";

export function getExchangeAdapter(source?: string): ExchangeAdapter {
  if (source === "bitget_public") {
    return new BitgetPublicAdapter();
  }

  return new MockExchangeAdapter();
}
