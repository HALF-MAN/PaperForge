---
name: quant-backtest
description: Use when a strategy spec must be evaluated against historical or simulated market data and produce return, drawdown, win rate, trade count, profit factor, and audit metadata.
---

# Quant Backtest

Use this skill after a strategy spec exists.

## Instructions

- Run the backtest executor against the mission StrategySpec and MarketDataSnapshot.
- Produce performance metrics and execution assumptions.
- Persist the report as mission evidence.
- Do not change the strategy silently.

## Deliverable

The deliverable is a `BacktestReport` artifact.
