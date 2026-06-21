---
name: paper-trading
description: Use when a quant mission is allowed to simulate paper orders after strategy, backtest, risk, and review evidence are available; never use for live exchange order placement.
---

# Paper Trading

Use this skill only for paper-only simulation.

## Instructions

- Simulate orders using the approved mission strategy and risk constraints.
- Record PnL, drawdown, order count, and simulated order details.
- Never call a real order-placement API.
- Keep live dry-run disabled unless a later approval explicitly permits it.

## Deliverable

The deliverable is a `PaperSession` artifact.
