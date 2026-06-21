---
name: mission-intake
description: Use when a new PaperForge mission is created and the agent must capture the task objective, constraints, domain, operating mode, and initial durable TaskBrief artifact before planning any workflow.
---

# Mission Intake

Use this skill at the start of every mission.

## Instructions

- Extract the mission title, objective, trading domain, target symbol, timeframe, and safety constraints.
- Keep execution approval-gated by default.
- Produce a durable `TaskBrief` artifact.
- Do not select agents or execute business logic in this skill.

## Deliverable

The deliverable is a `TaskBrief` artifact that downstream planning and execution skills can reference.
