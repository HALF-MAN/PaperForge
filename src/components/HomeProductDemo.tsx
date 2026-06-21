"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Braces,
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  LineChart,
  LoaderCircle,
  Pause,
  Play,
  RefreshCcw,
  Save,
  Wrench,
} from "lucide-react";

const stages = [
  "提出问题",
  "市场研究",
  "研究结论",
  "请求策略",
  "生成代码",
  "沙箱回测",
  "绩效报告",
  "编辑代码",
  "再次验证",
  "更新报告",
];

const initialCode = [
  "class Strategy:",
  "    def __init__(self):",
  "        self.rsi_period = 14",
  "        self.oversold = 30",
  "        self.bb_period = 20",
  "        self.stop_loss_pct = 5.0",
  "",
  "    def generate_signals(self, df):",
  "        rsi = indicators.rsi(df.close, 14)",
  "        lower = indicators.bollinger(df.close, 20).lower",
  "        return (rsi < 30) & (df.close < lower)",
];

const editedCode = initialCode.map((line) =>
  line
    .replace("self.oversold = 30", "self.oversold = 26")
    .replace("self.stop_loss_pct = 5.0", "self.stop_loss_pct = 3.5")
    .replace("rsi < 30", "rsi < 26"),
);

export default function HomeProductDemo() {
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [editStep, setEditStep] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const nextStage = (stage + 1) % stages.length;
    const timer = window.setTimeout(
      () => {
        if (nextStage === 7) setEditStep(0);
        setStage(nextStage);
      },
      stage === 7 ? 4800 : stage === 1 || stage === 5 || stage === 8 ? 3200 : 2700,
    );
    return () => window.clearTimeout(timer);
  }, [playing, stage]);

  useEffect(() => {
    if (stage !== 7) return;
    const timer = window.setInterval(() => {
      setEditStep((current) => Math.min(current + 1, 3));
    }, 900);
    return () => window.clearInterval(timer);
  }, [stage]);

  const showResearch = stage >= 1;
  const showBrief = stage >= 2;
  const showCodeRequest = stage >= 3;
  const showArtifact = stage >= 4;
  const isRunning = stage === 5 || stage === 8;
  const showPerformance = stage === 6 || stage === 9;
  const showEditedCode = stage === 7;
  const activeTab = showPerformance ? "performance" : isRunning ? "logs" : "code";
  const improved = stage === 9;

  return (
    <div className="pf-product-demo-shell">
      <div className="pf-product-demo-toolbar">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="pf-agent-live-dot" />
            <strong>Product walkthrough</strong>
            <span className="hidden text-[#98a2b3] sm:inline">研究 → 生成 → 回测 → 编辑 → 再验证</span>
          </div>
          <div className="pf-product-demo-progress" aria-label={`演示步骤：${stages[stage]}`}>
            {stages.map((label, index) => (
              <span key={label} className={index <= stage ? "is-active" : ""} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[9px] text-[#667085] sm:inline">{stages[stage]}</span>
          <button
            type="button"
            className="pf-product-demo-control"
            onClick={() => setPlaying((current) => !current)}
            title={playing ? "暂停演示" : "继续演示"}
            aria-label={playing ? "暂停演示" : "继续演示"}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            type="button"
            className="pf-product-demo-control"
            onClick={() => { setStage(0); setEditStep(0); setPlaying(true); }}
            title="重新播放"
            aria-label="重新播放"
          >
            <RefreshCcw size={13} />
          </button>
        </div>
      </div>

      <div className="pf-home-scene pf-product-demo" aria-label="PaperForge Strategy Lab interactive product demo">
        <div className="pf-home-scene-rail">
          <div className="flex items-center gap-2 px-4 py-4">
            <span className="grid size-7 place-items-center rounded-md bg-[#101828] text-white"><Braces size={14} /></span>
            <span className="text-sm font-semibold text-[#101828]">PaperForge</span>
          </div>
          <div className="px-3 pt-4">
            <p className="px-2 text-[9px] font-semibold uppercase text-[#98a2b3]">Today</p>
            <div className="mt-2 rounded-md bg-[#eef4ff] px-3 py-3">
              <p className="text-xs font-semibold text-[#344054]">BTC strategy research</p>
              <p className="mt-1 text-[9px] text-[#667085]">Agent session · live</p>
            </div>
            <div className="mt-3 px-3 py-2 text-[9px] text-[#98a2b3]">KDJ research</div>
            <div className="px-3 py-2 text-[9px] text-[#98a2b3]">Saved strategies</div>
          </div>
        </div>

        <div className="pf-home-scene-chat">
          <div className="flex h-12 items-center justify-between border-b border-[#e7ebf0] px-5">
            <div>
              <p className="text-xs font-semibold text-[#101828]">BTC strategy research</p>
              <p className="text-[9px] text-[#98a2b3]">Conversation context preserved</p>
            </div>
            <span className="font-mono text-[8px] text-[#98a2b3]">{String(stage + 1).padStart(2, "0")} / 10</span>
          </div>

          <div className="pf-product-demo-chat-feed">
            <div className="pf-demo-message pf-demo-message-user">
              分析当前 BTCUSDT 4 小时行情，适合什么策略？
            </div>

            {showResearch ? (
              <div className="pf-demo-agent-card pf-demo-enter">
                <div className="flex items-center gap-2 text-[10px] font-semibold text-[#2f6fed]"><Bot size={13} /> StrategyLabAgent</div>
                {showBrief ? (
                  <>
                    <p className="mt-3 text-[11px] font-semibold text-[#101828]">BTCUSDT · 4h market brief</p>
                    <p className="mt-2 text-[9px] leading-4 text-[#667085]">低波动弱下降的震荡格局。资金费率接近中性，持仓量稳定，当前更适合有趋势过滤的均值回归。</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {[["Regime", "Ranging"], ["RSI 14", "45.6"], ["ATR", "1.17%"]].map(([label, value]) => (
                        <div key={label} className="rounded-md bg-[#f8fafc] px-2 py-2"><small>{label}</small><strong>{value}</strong></div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 space-y-2">
                    {["读取 Bitget 4h K 线与技术指标", "检查资金费率、持仓量与订单簿", "检索带来源的策略依据"].map((item, index) => (
                      <div key={item} className="pf-demo-tool-row" style={{ animationDelay: `${index * 180}ms` }}>
                        {index < 2 ? <Check size={11} /> : <LoaderCircle size={11} className="animate-spin" />} {item}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {showCodeRequest ? <div className="pf-demo-message pf-demo-message-user pf-demo-enter">基于第一个策略生成可回测代码</div> : null}

            {showArtifact ? (
              <div className="pf-demo-artifact-card pf-demo-enter">
                <div className="flex items-center gap-2"><FileCode2 size={14} className="text-[#2f6fed]" /><strong>RSI Bollinger Mean Reversion</strong></div>
                <p>代码已通过 Schema 与沙箱安全校验，可调整参数后运行回测。</p>
                <div className="mt-2 flex items-center gap-3 font-mono text-[8px] text-[#667085]"><span>83 lines</span><span>6 params</span><span>2 sources</span></div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="pf-home-scene-inspector">
          <div className="flex h-12 items-center justify-between border-b border-[#e7ebf0] px-5">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#101828]">RSI Bollinger Mean Reversion</p>
              <p className="text-[9px] text-[#98a2b3]">Typed strategy artifact</p>
            </div>
            {showArtifact ? (
              <span className={`pf-demo-run-button ${isRunning ? "is-running" : ""}`}>
                {isRunning ? <LoaderCircle size={11} className="animate-spin" /> : <Play size={11} fill="currentColor" />}
                {isRunning ? "Running" : "Run"}
              </span>
            ) : null}
          </div>

          <div className="pf-demo-tabs">
            {[
              ["code", "策略代码"],
              ["performance", "策略绩效"],
              ["trades", "交易"],
              ["positions", "持仓"],
              ["logs", "日志"],
              ["analysis", "分析"],
            ].map(([tab, label]) => (
              <span key={tab} className={activeTab === tab ? "is-active" : ""}>{label}</span>
            ))}
          </div>

          <div className="pf-product-demo-inspector-body">
            {!showArtifact ? (
              <div className="pf-demo-empty"><Code2 size={22} /><p>代码与回测结果将在这里打开</p></div>
            ) : activeTab === "code" ? (
              <CodePanel edited={showEditedCode} editStep={editStep} />
            ) : activeTab === "logs" ? (
              <RunLog rerun={stage === 8} />
            ) : (
              <PerformancePanel improved={improved} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CodePanel({ edited, editStep }: { edited: boolean; editStep: number }) {
  const lines = initialCode.map((line, index) => {
    if (!edited) return line;
    if (index === 3 && editStep >= 1) return editedCode[index];
    if (index === 5 && editStep >= 2) return editedCode[index];
    if (index === 10 && editStep >= 3) return editedCode[index];
    return line;
  });
  const activeLine = editStep === 1 ? 3 : editStep === 2 ? 5 : editStep >= 3 ? 10 : -1;
  return (
    <div className="pf-demo-code-wrap pf-demo-enter">
      <div className="pf-demo-code-head">
        <span>strategy.py</span>
        <span>{edited ? `editing · ${Math.min(editStep, 3)}/3` : "validated"}</span>
      </div>
      <pre className="pf-demo-code">
        {lines.map((line, index) => {
          const changed = edited && [3, 5, 10].includes(index) && index <= activeLine;
          const typing = edited && index === activeLine;
          return <code key={`${index}-${line}`} className={`${changed ? "is-changed" : ""} ${typing ? "is-typing" : ""}`}><i>{index + 1}</i>{line || " "}</code>;
        })}
      </pre>
      <div className="pf-demo-param-strip">
        <span><Wrench size={10} /> {edited ? ["Select parameter", "oversold 30 → 26", "stop loss 5.0 → 3.5", "signal RSI 30 → 26"][editStep] : "6 typed parameters"}</span>
        <span><Check size={10} /> Schema valid</span>
      </div>
      <div className="pf-demo-backtest-settings">
        <span><small>Data</small>Bitget public</span>
        <span><small>Range</small>2024/01/01 — 2024/12/31</span>
        <span><small>Timeframe</small>4h</span>
      </div>
    </div>
  );
}

function RunLog({ rerun }: { rerun: boolean }) {
  return (
    <div className="pf-demo-log pf-demo-enter">
      <div><span>00:00</span> Loading BTCUSDT 4h candles...</div>
      <div><span>00:01</span> Validating parameter schema</div>
      <div><span>00:02</span> Starting restricted Python sandbox</div>
      <div><span>00:03</span> {rerun ? "Applying edited risk parameters" : "Executing strategy signals"}</div>
      <div className="is-live"><LoaderCircle size={11} className="animate-spin" /> Calculating trades and metrics</div>
    </div>
  );
}

function PerformancePanel({ improved }: { improved: boolean }) {
  const metrics = [
    ["累计收益", improved ? "+6.84%" : "-1.72%", improved ? "good" : "bad"],
    ["年化收益", improved ? "+6.84%" : "-1.72%", improved ? "good" : "bad"],
    ["夏普比率", improved ? "1.12" : "0.09", "neutral"],
    ["最大回撤", improved ? "8.63%" : "24.74%", improved ? "good" : "bad"],
    ["胜率", improved ? "58.33%" : "40.00%", "neutral"],
  ];
  const monthlyReturns = improved
    ? [1.6, -0.8, 2.4, 3.1, -1.1, 2.2, 4.6, -0.4, 5.3, 2.1, 3.8, 1.9]
    : [0, 0, 0, -2.8, 0.2, 1.1, -0.3, -3.6, 4.9, 1.4, 0, 0];

  return (
    <div className="pf-demo-performance pf-demo-enter">
      <div className="pf-demo-metrics">
        {metrics.map(([label, value, tone]) => (
          <div key={label}><strong className={`is-${tone}`}>{value}</strong><small>{label}</small></div>
        ))}
      </div>
      <div className="pf-demo-chart pf-demo-chart-primary">
        <div className="pf-demo-chart-title"><span><LineChart size={11} /> 累计收益</span><small>BTCUSDT · 4h · 365 candles</small></div>
        <svg viewBox="0 0 340 92" role="img" aria-label="Animated cumulative return chart">
          <path d="M8 18H332M8 46H332M8 74H332" className="grid" />
          <path d="M8 54 C36 34,48 39,72 28 S108 56,132 44 S170 64,194 46 S228 31,250 39 S292 20,332 25" className="benchmark" />
          <path d={improved
            ? "M8 56 C32 51,44 34,68 39 S101 24,126 30 S158 19,181 25 S216 13,239 19 S276 8,300 14 S321 5,332 7"
            : "M8 55 C31 63,45 39,67 48 S101 69,125 61 S160 65,181 76 S213 57,238 66 S276 53,300 63 S321 54,332 55"} className="strategy" />
        </svg>
        <div className="pf-demo-chart-axis"><span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span></div>
      </div>
      <div className="pf-demo-chart-grid">
        <div className="pf-demo-mini-chart is-drawdown">
          <div className="pf-demo-chart-title"><span>回撤分析</span><small>{improved ? "8.63%" : "24.74%"} max</small></div>
          <svg viewBox="0 0 160 52" role="img" aria-label="Drawdown analysis chart">
            <path d="M4 8H156M4 27H156M4 46H156" className="grid" />
            <path d={improved ? "M4 8 L24 8 L34 16 L45 9 L58 24 L70 12 L84 20 L98 10 L112 18 L126 9 L142 13 L156 8" : "M4 8 L26 8 L38 23 L49 15 L61 36 L72 24 L84 45 L97 31 L110 47 L124 27 L139 35 L156 29"} className="drawdown" />
          </svg>
        </div>
        <div className="pf-demo-mini-chart">
          <div className="pf-demo-chart-title"><span>月度收益</span><small>12 months</small></div>
          <div className="pf-demo-month-bars" aria-label="Monthly returns bar chart">
            {monthlyReturns.map((value, index) => (
              <span key={index} className={value < 0 ? "is-negative" : ""} style={{ height: `${Math.max(2, Math.abs(value) * 5)}px` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="pf-demo-save"><Save size={11} /> {improved ? "Updated report ready to save" : "Report linked to this code version"}<ChevronRight size={12} /></div>
    </div>
  );
}
