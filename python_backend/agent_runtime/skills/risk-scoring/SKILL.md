---
name: risk-scoring
description: Use when a mission needs a deployment risk decision based on strategy parameters, backtest evidence, position sizing, leverage, drawdown, and policy constraints.
---

# Risk Scoring

Use this skill after backtesting.

## Instructions

- Score mission risk as `PASS`, `WARN`, or `BLOCK`.
- Explain every issue and recommendation.
- Apply policy constraints before any execution-like step.
- Block downstream paper or dry-run steps if risk is unacceptable.

## Deliverable

The deliverable is a `RiskReport` artifact.
