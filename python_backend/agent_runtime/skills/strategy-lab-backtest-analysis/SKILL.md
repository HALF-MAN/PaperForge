---
name: strategy-lab-backtest-analysis
description: Use when a Strategy Lab user explicitly asks to run, backtest, evaluate, or explain the active strategy result.
---

# Strategy Lab Backtest Analysis

Run or interpret the active strategy without automatically optimizing it.

## Instructions

- Call `run_strategy_backtest` only after an explicit run or backtest request.
- Use the active code package and user-supplied settings when available.
- Supported data sources are only `mock` (simulated candles) and `bitget_public` (public Bitget candles). Never invent another source.
- Report whether the data source is real or simulated.
- Explain return, drawdown, Sharpe ratio, win rate, and trade count without promising future performance.
- Do not modify or regenerate strategy code unless the user separately asks for changes.

## Allowed Tools

- `run_strategy_backtest`

## Deliverable

A persisted backtest result proposal and a concise risk-aware interpretation.
