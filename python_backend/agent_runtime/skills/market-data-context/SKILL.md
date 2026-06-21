---
name: market-data-context
description: Use when a quant mission needs market context such as symbol, market type, timeframe, recent candles, ticker state, or data-window metadata before strategy research or backtesting.
---

# Market Data Context

Use this skill before strategy specification or backtesting.

## Instructions

- Resolve the target symbol, market, and timeframe from the TaskBrief.
- Load or simulate the current market-data window.
- Record the data source and time window.
- Do not place orders or mutate exchange state.

## Deliverable

The deliverable is a `MarketDataSnapshot` artifact.
