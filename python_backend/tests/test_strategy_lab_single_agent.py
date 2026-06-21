from __future__ import annotations

import unittest

from agent_runtime.strategy_lab_single_agent import (
    _agent_runtime_error_message,
    _load_strategy_skill,
    _strategy_recommendation_markdown,
    _tool_result_summary,
)


class StrategyRecommendationFallbackTest(unittest.TestCase):
    def test_loads_market_research_skill_from_short_alias(self) -> None:
        skill = _load_strategy_skill("market-analysis")

        self.assertEqual(skill["name"], "strategy-lab-market-research")
        self.assertEqual(skill["requestedName"], "market-analysis")

    def test_summarizes_agent_framework_content_objects(self) -> None:
        content = type("Content", (), {"text": '{"fundingRate":"0.0001"}'})()

        self.assertEqual(_tool_result_summary([content]), '{"fundingRate":"0.0001"}')

    def test_builds_answer_from_real_candidates_and_sources(self) -> None:
        content = _strategy_recommendation_markdown(
            [
                {
                    "name": "RSI Bollinger Mean Reversion",
                    "summary": "震荡市场均值回归。",
                    "matchReasons": ["适配 ranging"],
                    "failureModes": ["单边趋势中容易连续止损"],
                    "riskControls": ["限制单笔风险"],
                    "sources": [
                        {
                            "title": "Freqtrade Strategy 101",
                            "sourceUrl": "https://www.freqtrade.io/en/stable/strategy-101/",
                        }
                    ],
                }
            ],
            fallback_reason="严格条件无候选",
        )

        self.assertIn("RSI Bollinger Mean Reversion", content)
        self.assertIn("单边趋势中容易连续止损", content)
        self.assertIn("https://www.freqtrade.io", content)
        self.assertIn("严格条件无候选", content)

    def test_timeout_error_is_concise_and_actionable(self) -> None:
        content = _agent_runtime_error_message(RuntimeError("APITimeoutError: Request timed out."))

        self.assertIn("响应超时", content)
        self.assertNotIn("agent_framework_openai", content)


if __name__ == "__main__":
    unittest.main()
