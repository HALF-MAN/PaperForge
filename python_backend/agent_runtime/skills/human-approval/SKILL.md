---
name: human-approval
description: Use when a PaperForge workflow must pause for an explicit human decision before dry-run, deployment, revision, or any irreversible or sensitive action.
---

# Human Approval

Use this skill at governance boundaries.

## Instructions

- Summarize evidence, residual risk, and proposed next action.
- Pause the workflow until a human approves, rejects, or requests revision.
- Do not continue into live dry-run automatically.

## Deliverable

The deliverable is an `ApprovalDecision` artifact.
