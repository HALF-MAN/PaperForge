"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  Activity,
  BarChart3,
  Zap,
  ArrowRight,
  CheckCircle2,
  Play,
  LineChart,
  Shield
} from "lucide-react";

export default function StrategyLibrary() {
  const router = useRouter();
  const [naturalLanguageInput, setNaturalLanguageInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // 策略模板数据（模拟）
  const strategyTemplates = [
    {
      id: "template-ema-breakout",
      name: "EMA Trend Breakout",
      category: "Trend-following",
      symbol: "BTC/ETH",
      performance: { sharpe: 1.8, winRate: 65 },
      description: "EMA crossover strategy with RSI filter for trend continuation",
      tags: ["trend", "ema", "momentum"],
    },
    {
      id: "template-rsi-reversal",
      name: "RSI Mean-Reversion",
      category: "Mean-Reversion",
      symbol: "Altcoins",
      performance: { sharpe: 1.2, winRate: 58 },
      description: "RSI overbought/oversold reversal with volume confirmation",
      tags: ["reversal", "rsi", "volume"],
    },
    {
      id: "template-multi-factor",
      name: "Multi-factor Momentum",
      category: "Multi-factor",
      symbol: "All Crypto",
      performance: { sharpe: 2.1, winRate: 72 },
      description: "Momentum + Volume + Sentiment composite scoring",
      tags: ["multi-factor", "momentum", "sentiment"],
    },
    {
      id: "template-bollinger-bands",
      name: "Bollinger Bands Breakout",
      category: "Volatility",
      symbol: "BTC/ETH",
      performance: { sharpe: 1.5, winRate: 60 },
      description: "Bollinger Bands squeeze breakout with volatility expansion",
      tags: ["volatility", "bollinger", "breakout"],
    },
  ];

  const handleDeployTemplate = async (templateId: string) => {
    setIsGenerating(true);

    try {
      // 调用后端创建策略（基于模板）
      const response = await fetch("http://127.0.0.1:8765/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: strategyTemplates.find(t => t.id === templateId)?.name,
          objective: `Deploy ${templateId} strategy`,
          domain: "quant",
        }),
      });

      if (!response.ok) throw new Error("Failed to create strategy");

      const data = await response.json();
      const strategyId = data.mission.id;

      // 自动执行 workflow
      await fetch("http://127.0.0.1:8765/missions/run-flow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId: strategyId }),
      });

      // 跳转到策略详情页
      router.push(`/strategies/${strategyId}`);
    } catch (error) {
      console.error("Error deploying template:", error);
      alert("Failed to deploy strategy template. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateFromNL = async () => {
    if (!naturalLanguageInput.trim()) {
      alert("Please describe your strategy first.");
      return;
    }

    setIsGenerating(true);

    try {
      // 调用后端 AI 生成策略
      const response = await fetch("http://127.0.0.1:8765/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Custom Strategy from Natural Language",
          objective: naturalLanguageInput,
          domain: "quant",
        }),
      });

      if (!response.ok) throw new Error("Failed to generate strategy");

      const data = await response.json();
      const strategyId = data.mission.id;

      // 自动执行 workflow（AI 生成策略 spec）
      await fetch("http://127.0.0.1:8765/missions/run-flow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId: strategyId }),
      });

      // 跳转到策略详情页
      router.push(`/strategies/${strategyId}`);
    } catch (error) {
      console.error("Error generating strategy:", error);
      alert("Failed to generate strategy. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* ═════════════════ Header ═════════════════ */}
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 size={28} className="text-[var(--accent)]" />
              <h1 className="text-2xl font-bold text-[var(--foreground)]">Strategy Library</h1>
            </div>
            <div className="text-sm text-[var(--muted)]">
              Pre-built Templates & AI Strategy Generation
            </div>
          </div>
        </div>
      </header>

      {/* ═════════════════ Create Custom Strategy (AI) ═════════════════ */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-xl border-2 border-[var(--accent)] bg-[var(--accent)]/10 p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="rounded-lg bg-[var(--accent)]/20 p-3">
              <Zap size={32} className="text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[var(--accent-strong)]">
                Create Strategy from Natural Language
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Describe your trading strategy in plain English. AI will analyze your description and generate a complete strategy specification with entry/exit rules, risk parameters, and backtest configuration.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <textarea
              value={naturalLanguageInput}
              onChange={(e) => setNaturalLanguageInput(e.target.value)}
              placeholder="Describe your strategy here... Example: 'I want a BTCUSDT trend-following strategy that uses EMA 20 and EMA 60 crossover as entry signal, with RSI confirmation to avoid overbought entries. Stop loss at 3% and take profit at 6%.'"
              className="w-full min-h-[120px] rounded-xl border border-[var(--line)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] placeholder-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              disabled={isGenerating}
            />

            <button
              onClick={handleGenerateFromNL}
              disabled={isGenerating || !naturalLanguageInput.trim()}
              className="w-full rounded-xl bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white transition-all hover:bg-[var(--accent-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <span className="flex items-center justify-center gap-2">
                  <Activity size={20} className="animate-spin" />
                  Generating Strategy with AI...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Zap size={20} />
                  Generate Strategy with AI
                </span>
              )}
            </button>
          </div>

          <div className="mt-6 flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
            <Shield size={16} className="mt-0.5 text-[var(--success)]" />
            <div className="text-sm text-[var(--muted)]">
              <strong className="text-[var(--foreground)]">AI Safety:</strong> Generated strategies go through validation, backtest, and risk assessment phases before any real execution. All strategies start in paper trading mode.
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════ Strategy Templates ═════════════════ */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Strategy Templates</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Pre-built strategies tested on historical data. Deploy instantly or customize parameters.
          </p>
        </div>

        {/* Category Filter */}
        <div className="mb-6 flex gap-2">
          {["All", "Trend", "Momentum", "Mean-Reversion", "Multi-Factor"].map((cat) => (
            <button
              key={cat}
              className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Template Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {strategyTemplates.map((template) => (
            <div
              key={template.id}
              className="group rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6 transition-all hover:border-[var(--accent)] hover:shadow-lg"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-[var(--foreground)] group-hover:text-[var(--accent)]">
                    {template.name}
                  </h3>
                  <div className="mt-1 flex items-center gap-2 text-sm text-[var(--muted)]">
                    <span className="rounded-full border border-[var(--line)] px-2 py-1">
                      {template.category}
                    </span>
                    <span>•</span>
                    <span>{template.symbol}</span>
                  </div>
                </div>
                <CheckCircle2 size={20} className="text-[var(--success)]" />
              </div>

              <p className="text-sm text-[var(--muted)] mb-4">{template.description}</p>

              {/* Performance Metrics */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
                  <div className="text-xs text-[var(--muted)]">Sharpe Ratio</div>
                  <div className="text-lg font-bold text-[var(--success)]">
                    {template.performance.sharpe.toFixed(1)}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
                  <div className="text-xs text-[var(--muted)]">Win Rate</div>
                  <div className="text-lg font-bold text-[var(--accent)]">
                    {template.performance.winRate}%
                  </div>
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-2 mb-4">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[var(--accent)]/15 px-2 py-1 text-xs text-[var(--accent)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleDeployTemplate(template.id)}
                  disabled={isGenerating}
                  className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white transition-all hover:bg-[var(--accent-strong)] disabled:opacity-50"
                >
                  {isGenerating ? "Generating..." : "Deploy"}
                </button>
                <button
                  className="rounded-lg border border-[var(--line)] px-4 py-3 text-sm font-medium text-[var(--muted)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Details
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═════════════════ Footer ═════════════════ */}
      <footer className="border-t border-[var(--line)] py-6">
        <div className="mx-auto max-w-6xl px-6">
          <nav className="flex items-center justify-center gap-6 text-sm">
            <a href="/dashboard" className="text-[var(--muted)] hover:text-[var(--accent)]">Dashboard</a>
            <a href="/strategy-library" className="text-[var(--accent)]">Strategy Library</a>
            <a href="/strategies" className="text-[var(--muted)] hover:text-[var(--accent)]">All Strategies</a>
            <a href="/live-monitor" className="text-[var(--muted)] hover:text-[var(--accent)]">Live Monitor</a>
          </nav>
          <p className="mt-4 text-center text-xs text-[var(--faint)]">
            PaperForge Strategy Library · AI-Driven Strategy Generation · Bitget AI Hackathon 2026
          </p>
        </div>
      </footer>
    </div>
  );
}