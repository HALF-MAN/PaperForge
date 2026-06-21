---
name: strategy-lab-code-generation
description: Use only when a Strategy Lab user explicitly asks to write, generate, implement, or modify runnable Python strategy code.
---

# Strategy Lab Code Generation

Generate sandbox-compatible Python strategy code from the current conversation context.

## Instructions

- Inherit the latest explicit symbol, timeframe, indicator, strategy choice, and risk requirements.
- Define `class Strategy` with `generate_signals(self, df)`.
- Return a DataFrame containing a `signal` column with values `-1`, `0`, or `1`.
- Use only pandas, numpy, math, and datetime-compatible logic.
- Expose editable parameters with `# @param: id|label|type|default|min-max` comments.
- Do not use network, filesystem, subprocess, environment, reflection, or dynamic execution APIs.
- After generating code, call `validate_and_commit_code`.
- If validation fails, correct the reported errors and retry at most once.
- Never claim a code package was created unless `validate_and_commit_code` succeeds.

## Allowed Tools

- `validate_and_commit_code`

## Deliverable

A validated `code_package` artifact proposal and a short explanation.

