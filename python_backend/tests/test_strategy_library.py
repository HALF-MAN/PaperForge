from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_runtime.models import StrategySearchQuery
from agent_runtime.strategy_library_eval import evaluate_strategy_library
from agent_runtime.strategy_library_store import StrategyLibraryStore
from agent_runtime.strategy_library_store import resolve_strategy_references


class StrategyLibraryStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = StrategyLibraryStore(Path(self.temp_dir.name) / "strategy-library.sqlite")
        self.store.seed_if_empty()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_seeds_reviewed_cards_with_traceable_sources(self) -> None:
        cards = self.store.list_cards()
        self.assertEqual(len(cards), 12)
        detail = self.store.get_card("strategy-card-grid-strike-market-making")
        self.assertIsNotNone(detail)
        self.assertEqual(detail["sources"][0]["provider"], "hummingbot")
        self.assertTrue(detail["sources"][0]["source_url"].startswith("https://"))
        self.assertEqual(detail["validations"][0]["status"], "informational")

    def test_search_uses_no_vector_and_returns_score_evidence(self) -> None:
        result = self.store.search(
            StrategySearchQuery(
                query="震荡 RSI 反转",
                market="crypto_perpetual",
                timeframe="4h",
                regime="ranging",
                available_data=["ohlcv"],
            )
        )
        self.assertFalse(result["vectorSearchUsed"])
        self.assertEqual(result["results"][0]["id"], "strategy-card-rsi-bollinger-mean-reversion")
        self.assertTrue(result["results"][0]["scoreComponents"])
        self.assertTrue(result["results"][0]["matchReasons"])

    def test_required_data_hard_filter_excludes_market_making(self) -> None:
        result = self.store.search(
            StrategySearchQuery(
                query="做市网格",
                market="crypto_spot",
                timeframe="1h",
                available_data=["ohlcv"],
                limit=10,
            )
        )
        families = {item["family"] for item in result["results"]}
        self.assertNotIn("market_making", families)
        self.assertNotIn("grid", families)
        self.assertNotIn("cross_exchange_arbitrage", families)

    def test_twenty_case_offline_evaluation_meets_baseline(self) -> None:
        result = evaluate_strategy_library(self.store)
        failures = [item for item in result["details"] if not item["passed"]]
        self.assertGreaterEqual(result["passRate"], 0.9, failures)

    def test_compare_keeps_hard_constraints_visible(self) -> None:
        result = self.store.compare(
            card_ids=[
                "strategy-card-rsi-bollinger-mean-reversion",
                "strategy-card-grid-strike-market-making",
            ],
            market="crypto_perpetual",
            timeframe="4h",
            regime="ranging",
            available_data=["ohlcv"],
        )
        self.assertTrue(result["results"][0]["eligible"])
        excluded = next(
            item for item in result["results"] if item["id"] == "strategy-card-grid-strike-market-making"
        )
        self.assertFalse(excluded["eligible"])
        self.assertTrue(excluded["excludedBy"])

    def test_design_validation_blocks_missing_required_data_and_persists(self) -> None:
        result = self.store.validate_design(
            card_id="strategy-card-grid-strike-market-making",
            market="crypto_spot",
            timeframe="1m",
            regime="ranging",
            available_data=["ohlcv"],
        )
        self.assertEqual(result["decision"], "failed")
        self.assertFalse(result["canGenerateCode"])
        self.assertTrue(any("缺少必需数据" in item for item in result["failures"]))
        detail = self.store.get_card("strategy-card-grid-strike-market-making")
        self.assertTrue(
            any(item["id"] == result["validationId"] for item in detail["validations"])
        )

    def test_design_validation_requires_explicit_data_inventory(self) -> None:
        result = self.store.validate_design(
            card_id="strategy-card-rsi-bollinger-mean-reversion",
            market="crypto_perpetual",
            timeframe="4h",
            regime="ranging",
            available_data=[],
            persist=False,
        )
        self.assertEqual(result["decision"], "warning")
        self.assertTrue(any("未提供可用数据清单" in item for item in result["warnings"]))

    def test_strategy_references_include_traceable_sources(self) -> None:
        references = resolve_strategy_references(
            ["strategy-card-rsi-bollinger-mean-reversion"]
        )
        self.assertEqual(references[0]["family"], "mean_reversion")
        self.assertTrue(references[0]["sources"][0]["sourceUrl"].startswith("https://"))


if __name__ == "__main__":
    unittest.main()
