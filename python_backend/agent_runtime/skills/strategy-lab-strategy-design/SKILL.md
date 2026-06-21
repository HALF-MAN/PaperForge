---
name: strategy-lab-strategy-design
description: Use when a Strategy Lab user wants to research, compare, or select strategy ideas after discussing market evidence.
---

# Strategy Lab Strategy Design

Use observed market evidence and the reviewed strategy library to compare strategy candidates.

## Instructions

- Reuse recent research context instead of asking the user to repeat it.
- Call `search_strategy_library` exactly once after relevant market evidence is available. Pass data types through comma-separated `available_data_csv` and use the returned candidates without retrying.
- Load the strongest candidates with `get_strategy_card` before recommending them.
- Use `compare_strategy_cards` once only when the user explicitly asks to compare or choose between named candidates.
- Call it with `first_card_id`, `second_card_id`, optional `third_card_id`, and a comma-separated `available_data_csv` value such as `ohlcv,orderbook`.
- Preserve the available-data inventory from the user and successful tools across search, comparison, and validation calls. Never turn an explicit `OHLCV` constraint into an empty list.
- Use `validate_strategy_design` before handing a selected library strategy to code generation.
- Use `compare_strategy_candidates` only as a broad fallback when the strategy library returns no candidates.
- Compare no more than three candidates.
- For each candidate, explain why it fits, what does not match, when it fails, what risk control is required, and which reviewed source supports it.
- Treat cards as research references, not executable templates or evidence of future returns.
- Never invent a strategy card or source outside tool results.
- Ask for clarification only when symbol, timeframe, or long/short constraints materially change the design.
- Do not create code unless the user explicitly requests implementation.

## Allowed Tools

- `compare_strategy_candidates`
- `search_strategy_library`
- `get_strategy_card`
- `compare_strategy_cards`
- `validate_strategy_design`
- `analyze_market_timeframe`

## Deliverable

A ranked strategy shortlist grounded in observed market conditions.
