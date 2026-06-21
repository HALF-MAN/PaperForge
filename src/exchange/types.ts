export type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  baseVolume: number;
  quoteVolume: number;
};

export type Ticker = {
  symbol: string;
  last: number;
  high24h?: number;
  low24h?: number;
  quoteVolume?: number;
  ts?: number;
};

export type ExchangeStatus = {
  exchange: "Bitget";
  dataSource: "mock" | "bitget_public";
  authConfigured: boolean;
  mode: "read_only" | "paper" | "live_dry_run" | "live_disabled";
  tradingEnabled: boolean;
  publicMarketData: boolean;
  message: string;
};

export type CandleRequest = {
  symbol: string;
  granularity: "1min" | "5min" | "15min" | "30min" | "1h" | "4h" | "1day";
  limit?: number;
};

export interface ExchangeAdapter {
  getStatus(): ExchangeStatus;
  getTicker(symbol: string): Promise<Ticker>;
  getCandles(input: CandleRequest): Promise<Candle[]>;
}
