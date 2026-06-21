import type { Candle, CandleRequest, ExchangeAdapter, ExchangeStatus, Ticker } from "./types";

export class MockExchangeAdapter implements ExchangeAdapter {
  getStatus(): ExchangeStatus {
    return {
      exchange: "Bitget",
      dataSource: "mock",
      authConfigured: false,
      mode: "paper",
      tradingEnabled: false,
      publicMarketData: false,
      message: "Using deterministic local market fixtures."
    };
  }

  async getTicker(symbol: string): Promise<Ticker> {
    return {
      symbol,
      last: symbol.startsWith("ETH") ? 3600 : 68000,
      high24h: symbol.startsWith("ETH") ? 3720 : 69200,
      low24h: symbol.startsWith("ETH") ? 3510 : 66800,
      quoteVolume: 125000000,
      ts: Date.now()
    };
  }

  async getCandles(input: CandleRequest): Promise<Candle[]> {
    const start = Date.now() - (input.limit ?? 100) * 60 * 60 * 1000;
    const base = input.symbol.startsWith("ETH") ? 3600 : 68000;
    const limit = input.limit ?? 100;

    return Array.from({ length: limit }, (_, index) => {
      const wave = Math.sin(index / 8) * 0.018;
      const trend = index * 0.0004;
      const close = Number((base * (1 + wave + trend)).toFixed(2));
      const open = Number((close * (1 - 0.002)).toFixed(2));

      return {
        ts: start + index * 60 * 60 * 1000,
        open,
        high: Number((close * 1.006).toFixed(2)),
        low: Number((close * 0.994).toFixed(2)),
        close,
        baseVolume: 120 + index,
        quoteVolume: close * (120 + index)
      };
    });
  }
}
