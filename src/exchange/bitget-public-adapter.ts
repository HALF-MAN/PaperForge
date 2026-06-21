import type { Candle, CandleRequest, ExchangeAdapter, ExchangeStatus, Ticker } from "./types";

const BITGET_BASE_URL = "https://api.bitget.com";

type BitgetResponse<T> = {
  code: string;
  msg: string;
  requestTime?: number;
  data: T;
};

type BitgetTicker = {
  symbol: string;
  lastPr: string;
  high24h?: string;
  low24h?: string;
  quoteVolume?: string;
  ts?: string;
};

export class BitgetPublicAdapter implements ExchangeAdapter {
  getStatus(): ExchangeStatus {
    const authConfigured = Boolean(
      process.env.BITGET_API_KEY &&
        process.env.BITGET_SECRET_KEY &&
        process.env.BITGET_PASSPHRASE
    );

    return {
      exchange: "Bitget",
      dataSource: "bitget_public",
      authConfigured,
      mode: process.env.BITGET_MODE === "read_only" ? "read_only" : "live_disabled",
      tradingEnabled: false,
      publicMarketData: true,
      message: authConfigured
        ? "API credentials detected. Trading remains disabled in PaperForge."
        : "Using public market data. Private read APIs require local credentials."
    };
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const params = new URLSearchParams({ symbol });
    const response = await fetchJson<BitgetTicker[]>(`/api/v2/spot/market/tickers?${params.toString()}`);
    const ticker = response.data[0];

    if (!ticker) {
      throw new Error(`Ticker not found for ${symbol}`);
    }

    return {
      symbol: ticker.symbol,
      last: Number(ticker.lastPr),
      high24h: ticker.high24h ? Number(ticker.high24h) : undefined,
      low24h: ticker.low24h ? Number(ticker.low24h) : undefined,
      quoteVolume: ticker.quoteVolume ? Number(ticker.quoteVolume) : undefined,
      ts: ticker.ts ? Number(ticker.ts) : response.requestTime
    };
  }

  async getCandles(input: CandleRequest): Promise<Candle[]> {
    const params = new URLSearchParams({
      symbol: input.symbol,
      granularity: input.granularity,
      limit: String(input.limit ?? 100)
    });
    const response = await fetchJson<string[][]>(`/api/v2/spot/market/candles?${params.toString()}`);

    return response.data
      .map(([ts, open, high, low, close, baseVolume, quoteVolume]) => ({
        ts: Number(ts),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        baseVolume: Number(baseVolume),
        quoteVolume: Number(quoteVolume)
      }))
      .sort((a, b) => a.ts - b.ts);
  }
}

async function fetchJson<T>(path: string): Promise<BitgetResponse<T>> {
  const response = await fetch(`${BITGET_BASE_URL}${path}`, {
    headers: {
      accept: "application/json"
    },
    next: {
      revalidate: 15
    }
  });

  if (!response.ok) {
    throw new Error(`Bitget request failed: ${response.status}`);
  }

  const payload = (await response.json()) as BitgetResponse<T>;

  if (payload.code !== "00000") {
    throw new Error(`Bitget API error ${payload.code}: ${payload.msg}`);
  }

  return payload;
}
