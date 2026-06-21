from __future__ import annotations

import unittest
from unittest.mock import patch

from agent_runtime.saved_strategy_store import _version_snapshot
from agent_runtime.strategy_lab_single_agent import (
    _run_active_backtest,
    _validate_and_prepare_code_package,
)
from agent_runtime.strategy_lab_store import _backtest_artifact


REFERENCE = {
    "id": "strategy-card-rsi-bollinger-mean-reversion",
    "name": "RSI + Bollinger Mean Reversion",
    "family": "mean_reversion",
    "sources": [
        {
            "id": "source-hummingbot-bollinger-v1",
            "provider": "hummingbot",
            "title": "Bollinger V2 Controller",
            "sourceUrl": "https://hummingbot.org/strategies/",
        }
    ],
}


VALID_CODE = """import pandas as pd

class Strategy:
    def __init__(self):
        # @param: period|Period|int|14|2-100
        self.period = 14

    def generate_signals(self, df):
        result = df.copy()
        result["signal"] = 0
        return result
"""


class StrategyProvenanceTest(unittest.TestCase):
    @patch(
        "agent_runtime.strategy_lab_single_agent.resolve_strategy_references",
        return_value=[REFERENCE],
    )
    def test_code_package_records_strategy_references(self, _resolve) -> None:
        result = _validate_and_prepare_code_package(
            title="RSI strategy",
            code=VALID_CODE,
            explanation="Uses a reviewed mean-reversion reference.",
            strategy_card_ids=[REFERENCE["id"]],
        )
        self.assertTrue(result["success"], result)
        self.assertEqual(result["codePackage"]["strategyReferences"], [REFERENCE])

    def test_backtest_and_saved_version_keep_strategy_references(self) -> None:
        run = _backtest_artifact(
            session_id="session-test",
            source={
                "id": "artifact-code-test",
                "title": "RSI strategy",
                "code": VALID_CODE,
                "strategyReferences": [REFERENCE],
            },
            result={"backtest": {}, "risk": {}},
            params={},
            now="2026-06-20T00:00:00+00:00",
        )
        self.assertEqual(run["strategyReferences"], [REFERENCE])

        version = _version_snapshot(
            strategy_id="strategy-test",
            artifact=run,
            version_number=1,
            now="2026-06-20T00:00:00+00:00",
        )
        self.assertEqual(version["strategyReferences"], [REFERENCE])

    def test_code_package_can_run_through_sandbox_backtest(self) -> None:
        result = _run_active_backtest(
            source={
                "id": "artifact-smoke",
                "title": "RSI strategy",
                "code": VALID_CODE,
                "params": {"period": 14},
                "strategyReferences": [REFERENCE],
            },
            start_date="2024-01-01",
            end_date="2024-12-31",
            data_source="mock",
            symbol="BTCUSDT",
            timeframe="4h",
        )
        self.assertTrue(result["success"], result)
        self.assertEqual(result["dataSource"], "mock")
        self.assertEqual(
            result["backtestProposal"]["source"]["strategyReferences"], [REFERENCE]
        )


if __name__ == "__main__":
    unittest.main()
