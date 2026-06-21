---
name: strategy-specification
description: Use when a quant mission requires a structured trading strategy spec with entry rules, exit rules, indicators, timeframe, risk parameters, and no live-execution permission.
---

# Strategy Specification

Use this skill after market data is available.

## Instructions

- Convert the mission objective into a structured `StrategySpec`.
- Include entry rules, exit rules, and risk controls.
- Reference the selected symbol, market, and timeframe.
- Do not approve live or dry-run execution.

## Deliverable

The deliverable is a `StrategySpec` artifact.
