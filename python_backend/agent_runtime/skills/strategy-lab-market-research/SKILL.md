---
name: strategy-lab-market-research
description: Use when a Strategy Lab user asks about current market conditions, trend, volatility, momentum, support for a strategy idea, or which strategy type fits the observed market.
---

# Strategy Lab Market Research

Use real market evidence before making current-market claims.

## Instructions

- Call `get_market_ticker` for a timestamped 24-hour snapshot.
- Call `analyze_market_timeframe` for at least one relevant timeframe.
- For broad market-regime questions, prefer both a medium and higher timeframe such as `4h` and `1day`.
- Use `futures_get_funding_rate` and `futures_get_open_interest` when assessing leverage, positioning, or crowding.
- Use `spot_get_depth` or `futures_get_depth` when discussing liquidity, spread, depth, or execution risk.
- Use `futures_get_contracts` to verify contract metadata instead of guessing product settings.
- Use `get_asset_profile` for market cap, FDV, supply, rank, and broader asset context.
- Use `get_global_crypto_market` for total market conditions, dominance, and fear-and-greed context.
- Use `get_onchain_metrics` when network usage, transaction activity, fees, supply, valuation, or hash rate is relevant.
- Use `get_btc_network_state` for current Bitcoin mempool congestion and transaction-fee pressure.
- Explain the observed trend, momentum, volatility, and regime using returned indicators.
- State the symbol, timeframe, data source, and observation time.
- Distinguish evidence from interpretation.
- If a market tool fails, say current data is unavailable. Never substitute mock data.
- Do not generate strategy code unless the user explicitly asks to write or implement it.

## Allowed Tools

- `get_market_ticker`
- `analyze_market_timeframe`
- `compare_strategy_candidates`
- `spot_get_ticker`
- `spot_get_depth`
- `spot_get_candles`
- `spot_get_trades`
- `spot_get_symbols`
- `futures_get_ticker`
- `futures_get_depth`
- `futures_get_candles`
- `futures_get_trades`
- `futures_get_contracts`
- `futures_get_funding_rate`
- `futures_get_open_interest`
- `get_asset_profile`
- `get_global_crypto_market`
- `get_onchain_metrics`
- `get_btc_network_state`

## Deliverable

A concise evidence-backed market assessment and optional strategy candidates.
