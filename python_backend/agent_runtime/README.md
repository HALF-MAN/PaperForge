# PaperForge Agent Runtime

This directory is the Python runtime boundary for PaperForge, powered by Microsoft Agent Framework and the Strategy Lab sandbox executor.

Mission orchestration uses Agent Framework Workflow API for quant pipeline execution, while the Next.js app serves as the product console.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Run

```bash
python3 -m agent_runtime --pretty
```

From the repository root, prefer the npm scripts because they set `PYTHONPATH` correctly:

```bash
npm run agent:demo
npm run backend:dev
```

The command prints a JSON payload shaped for the existing PaperForge platform:

- `mission_id`
- `status`
- `stop_reason`
- `strategy`
- `backtest`
- `risk`
- `paper`
- `events`

## Architecture

The runtime uses **Microsoft Agent Framework** for workflow execution:

- `WorkflowBuilder`: Fluent API for constructing DAG-based workflows
- `Executor`: Individual processing units for each pipeline phase
- `WorkflowContext`: Type-safe message passing between executors
- `QuantState`: Persistent state model stored in SQLite

Each pipeline phase (init → factor_mining → strategy → backtest → risk_audit → paper_trading → live_decision) is implemented as an independent Executor class, enabling modular and testable execution logic.

## Strategy Sandbox

Strategy Lab no longer depends on StrategySpec for its primary path. The app submits user-authored Python code to:

```http
POST /sandbox/execute
```

The sandbox executor:

- Runs static safety checks before execution.
- Allows only a small import/builtin surface.
- Accepts a `Strategy` class or any class implementing `generate_signals(data)`.
- Accepts signals returned as a `DataFrame` with a `signal` column, a `Series`, or a list.
- Returns backtest metrics, chart data, monthly returns, and risk recommendations.

The Next.js app proxies this route through:

```http
POST /api/sandbox/execute
```
