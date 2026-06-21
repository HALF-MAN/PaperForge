import Link from "next/link";
import type { Route } from "next";
import HomeProductDemo from "@/src/components/HomeProductDemo";
import {
  ArrowRight,
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Braces,
  Check,
  ChevronRight,
  Database,
  FileJson2,
  Gauge,
  LineChart,
  LockKeyhole,
  Newspaper,
  Play,
  Radio,
  Save,
  ShieldCheck,
  TerminalSquare,
  Wrench,
} from "lucide-react";

const architecture = [
  { label: "External Evidence", detail: "Bitget、链上、市场与消息数据，保留来源和观测时间", icon: Radio },
  { label: "Strategy References", detail: "带来源、适用条件和失败模式的结构化策略卡", icon: BookOpen },
  { label: "Agent Tool Loop", detail: "理解上下文，按意图选择研究、代码或回测工具", icon: Bot },
  { label: "Typed Artifacts", detail: "统一 Schema 约束代码、参数、来源与交付标准", icon: FileJson2 },
  { label: "Sandbox Evidence", detail: "受限 Python 执行，回测结果可保存、复现与分享", icon: ShieldCheck },
];

function ProductScene() {
  return (
    <div className="pf-home-scene" aria-label="PaperForge Strategy Lab product preview">
      <div className="pf-home-scene-rail">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid size-7 place-items-center rounded-md bg-[#101828] text-white">
            <Braces size={14} />
          </span>
          <span className="text-sm font-semibold text-[#101828]">PaperForge</span>
        </div>
        <div className="px-3 pt-4">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#98a2b3]">Today</p>
          <div className="mt-2 rounded-md bg-[#eef4ff] px-3 py-3">
            <p className="text-xs font-semibold text-[#344054]">BTC market research</p>
            <p className="mt-1 text-[10px] text-[#667085]">Bitget · 4h</p>
          </div>
        </div>
      </div>

      <div className="pf-home-scene-chat">
        <div className="flex h-12 items-center justify-between border-b border-[#e7ebf0] px-5">
          <div>
            <p className="text-xs font-semibold text-[#101828]">BTC market research</p>
            <p className="text-[9px] text-[#98a2b3]">Live research session</p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#667085]">
            <span className="size-1.5 rounded-full bg-[#12b76a]" />
            6 evidence sources
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="ml-auto w-fit max-w-[78%] rounded-md bg-[#2f6fed] px-3 py-2 text-[11px] leading-5 text-white">
            现在 BTC 是什么行情，适合什么策略？
          </div>

          <div className="max-w-[92%] rounded-md border border-[#dfe5ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.05)]">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-[#2f6fed]">
              <Bot size={13} /> StrategyLabAgent
            </div>
            <p className="text-[11px] font-semibold text-[#101828]">BTCUSDT · 4h market brief</p>
            <p className="mt-2 text-[10px] leading-5 text-[#667085]">
              当前处于低波动弱下降的震荡格局。Agent 已结合 4h 技术指标、资金费率、持仓量与订单簿完成判断。
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                ["Regime", "Ranging"],
                ["RSI 14", "45.6"],
                ["ATR", "1.17%"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-[#f8fafc] px-2 py-2">
                  <p className="text-[8px] uppercase tracking-[0.1em] text-[#98a2b3]">{label}</p>
                  <p className="mt-1 text-[10px] font-semibold text-[#344054]">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {["4h technical", "funding + OI", "strategy library"].map((tool) => (
              <span key={tool} className="inline-flex items-center gap-1 rounded-md border border-[#dfe5ec] bg-white px-2 py-1 text-[9px] text-[#667085]">
                <Check size={9} className="text-[#12b76a]" /> {tool}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="pf-home-scene-inspector">
        <div className="flex h-12 items-center justify-between border-b border-[#e7ebf0] px-5">
          <div>
            <p className="text-xs font-semibold text-[#101828]">RSI Bollinger Mean Reversion</p>
            <p className="text-[9px] text-[#98a2b3]">BTCUSDT · 4h · Bitget public data</p>
          </div>
          <span className="rounded-md bg-[#fff1f0] px-2 py-1 text-[9px] font-semibold text-[#e5484d]">Sandbox</span>
        </div>

        <div className="border-b border-[#e7ebf0] px-5 py-3">
          <div className="flex items-center gap-5 text-[10px] font-medium text-[#667085]">
            <span className="border-b-2 border-[#e5484d] pb-2 text-[#e5484d]">Performance</span>
            <span>Code</span>
            <span>Run log</span>
          </div>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Return", "-1.72%", "text-[#e5484d]"],
              ["Sharpe", "0.09", "text-[#101828]"],
              ["Drawdown", "24.74%", "text-[#e5484d]"],
            ].map(([label, value, color]) => (
              <div key={label}>
                <p className={`text-sm font-semibold ${color}`}>{value}</p>
                <p className="mt-1 text-[8px] uppercase tracking-[0.1em] text-[#98a2b3]">{label}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-md border border-[#e7ebf0] bg-[#fbfcfe] p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold text-[#344054]">Cumulative return</p>
              <LineChart size={13} className="text-[#2f6fed]" />
            </div>
            <svg viewBox="0 0 320 88" className="h-24 w-full" role="img" aria-label="BTC strategy backtest cumulative return chart">
              <path d="M0 72H320M0 44H320M0 16H320" stroke="#e8edf3" strokeWidth="1" />
              <path d="M0 43 C18 52,30 30,48 35 S74 52,91 61 S118 51,134 58 S160 46,177 62 S204 52,224 59 S250 44,269 54 S295 49,320 48" fill="none" stroke="#4f46e5" strokeWidth="2.5" />
              <path d="M0 44 C24 39,39 28,58 31 S91 20,112 35 S143 49,163 43 S197 53,216 46 S249 28,270 31 S300 19,320 23" fill="none" stroke="#a8b3c4" strokeWidth="1.5" />
              <circle cx="320" cy="48" r="3" fill="#4f46e5" />
            </svg>
            <div className="flex items-center justify-between text-[8px] text-[#98a2b3]">
              <span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span>
            </div>
            <div className="mt-2 flex items-center gap-4 text-[8px] text-[#667085]">
              <span className="inline-flex items-center gap-1"><i className="size-1.5 rounded-full bg-[#4f46e5]" /> Strategy</span>
              <span className="inline-flex items-center gap-1"><i className="size-1.5 rounded-full bg-[#a8b3c4]" /> BTC benchmark</span>
              <span className="ml-auto font-mono">365 candles</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-md border border-[#dfe5ec] bg-white px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] text-[#344054]">
              <Save size={12} className="text-[#2f6fed]" /> Save to My Strategies
            </div>
            <ChevronRight size={13} className="text-[#98a2b3]" />
          </div>
        </div>
      </div>
    </div>
  );
}

const researchSignals = [
  { label: "Technical", detail: "EMA · RSI · ATR · ADX", icon: Activity, tone: "blue" },
  { label: "Derivatives", detail: "Funding · OI · depth", icon: Gauge, tone: "cyan" },
  { label: "Market news", detail: "Events · sentiment · risk", icon: Newspaper, tone: "amber" },
  { label: "On-chain", detail: "Activity · fees · network", icon: Database, tone: "green" },
];

const agentOutputs = [
  { label: "Market brief", detail: "Evidence-backed answer", icon: LineChart },
  { label: "Strategy cards", detail: "Sources + failure modes", icon: BookOpen },
  { label: "Typed Python", detail: "Code + parameter schema", icon: FileJson2 },
  { label: "Backtest run", detail: "Metrics + reproducible log", icon: BarChart3 },
];

function AgentLoopScene() {
  return (
    <div className="pf-agent-loop" aria-label="PaperForge on-demand agent tool loop">
      <div className="pf-agent-loop-head">
        <div className="flex items-center gap-2">
          <span className="pf-agent-live-dot" />
          <span className="font-mono text-[10px] font-semibold uppercase text-[#344054]">Agent turn · BTCUSDT research</span>
        </div>
        <span className="font-mono text-[9px] text-[#98a2b3]">tools selected by intent</span>
      </div>

      <div className="pf-agent-loop-canvas">
        <svg className="pf-agent-loop-lines" viewBox="0 0 900 390" preserveAspectRatio="none" aria-hidden="true">
          {[72, 154, 236, 318].map((y, index) => (
            <path key={`in-${y}`} d={`M190 ${y} C280 ${y}, 290 195, 380 195`} className={`pf-loop-edge pf-loop-edge-${index + 1}`} />
          ))}
          {[72, 154, 236, 318].map((y, index) => (
            <path key={`out-${y}`} d={`M520 195 C610 195, 620 ${y}, 710 ${y}`} className={`pf-loop-edge pf-loop-edge-${index + 1}`} />
          ))}
        </svg>

        <div className="pf-agent-loop-column pf-agent-loop-inputs">
          <p className="pf-agent-loop-caption">External evidence</p>
          {researchSignals.map((signal) => {
            const Icon = signal.icon;
            return (
              <div key={signal.label} className={`pf-loop-node pf-loop-node-${signal.tone}`}>
                <span className="pf-loop-node-icon"><Icon size={14} /></span>
                <span><strong>{signal.label}</strong><small>{signal.detail}</small></span>
                <i />
              </div>
            );
          })}
        </div>

        <div className="pf-agent-loop-core">
          <span className="pf-agent-loop-orbit" />
          <div className="pf-agent-loop-core-icon"><Bot size={24} /></div>
          <strong>StrategyLabAgent</strong>
          <span>context + skills + tools</span>
          <div className="mt-3 flex items-center gap-1.5 font-mono text-[8px] text-[#667085]">
            <Wrench size={10} /> observe · decide · act
          </div>
        </div>

        <div className="pf-agent-loop-column pf-agent-loop-outputs">
          <p className="pf-agent-loop-caption">Useful artifacts</p>
          {agentOutputs.map((output) => {
            const Icon = output.icon;
            return (
              <div key={output.label} className="pf-loop-node pf-loop-node-output">
                <i />
                <span className="pf-loop-node-icon"><Icon size={14} /></span>
                <span><strong>{output.label}</strong><small>{output.detail}</small></span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pf-agent-loop-foot">
        <span><Check size={11} /> A question can end as an answer</span>
        <span><Check size={11} /> Code is generated only on request</span>
        <span><Check size={11} /> Every artifact keeps provenance</span>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f8fa] text-[#101828]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-black/[0.06] bg-[#f7f8fa]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 md:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="PaperForge home">
            <span className="grid size-8 place-items-center rounded-md bg-[#101828] text-white">
              <Braces size={17} />
            </span>
            <span className="text-[15px] font-semibold">PaperForge</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-[#667085] md:flex" aria-label="Primary navigation">
            <a href="#product" className="transition-colors hover:text-[#101828]">Product</a>
            <a href="#architecture" className="transition-colors hover:text-[#101828]">Architecture</a>
            <Link href="/strategies" className="transition-colors hover:text-[#101828]">My Strategies</Link>
            <Link href={"/marketplace" as Route} className="transition-colors hover:text-[#101828]">Marketplace</Link>
          </nav>

          <Link href="/strategy-lab" className="inline-flex h-9 items-center gap-2 rounded-md bg-[#101828] px-4 text-sm font-medium text-white transition-colors hover:bg-[#344054]">
            Open Strategy Lab <ArrowRight size={15} />
          </Link>
        </div>
      </header>

      <section className="relative min-h-[760px] px-5 pb-14 pt-32 md:min-h-[850px] md:px-8 md:pt-36">
        <div className="mx-auto max-w-[1180px] text-center">
          <div className="mx-auto inline-flex items-center gap-2 border-b border-[#cfd6df] pb-1.5 text-xs font-medium text-[#667085]">
            <span className="size-1.5 rounded-full bg-[#12b76a]" />
            Built for Bitget AI Hackathon 2026
          </div>

          <h1 className="mt-7 text-5xl font-semibold leading-[0.98] tracking-[-0.04em] text-[#101828] sm:text-6xl md:text-[88px]">
            PaperForge
          </h1>
          <p className="mt-5 text-xl font-medium text-[#344054] md:text-2xl">AI Quant Research Workspace</p>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[#667085] md:text-lg">
            从实时市场研究，到可验证的 Python 策略。先和 Agent 讨论行情，再按需生成代码、运行沙箱回测并保存版本。
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/strategy-lab" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#2f6fed] px-6 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(47,111,237,0.22)] transition-transform hover:-translate-y-0.5">
              <Play size={16} fill="currentColor" /> 开始研究 BTC
            </Link>
            <Link href="/strategies" className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-[#cfd6df] bg-white px-6 text-sm font-semibold text-[#344054] transition-colors hover:border-[#98a2b3]">
              查看我的策略 <ArrowRight size={16} />
            </Link>
          </div>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] font-medium text-[#7b8494]">
            <span className="inline-flex items-center gap-1.5"><Database size={13} /> Bitget public data</span>
            <span className="inline-flex items-center gap-1.5"><Bot size={13} /> Microsoft Agent Framework</span>
            <span className="inline-flex items-center gap-1.5"><LockKeyhole size={13} /> Restricted Python sandbox</span>
          </div>
        </div>

        <div className="mx-auto mt-14 max-w-[1240px] md:mt-16">
          <HomeProductDemo />
          <noscript><ProductScene /></noscript>
        </div>
      </section>

      <section id="product" className="border-y border-black/[0.07] bg-white">
        <div className="mx-auto max-w-[1240px] px-5 py-20 md:px-8 md:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.68fr_1.32fr] lg:items-center lg:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2f6fed]">Intent-driven agent</p>
              <h2 className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-[-0.025em] md:text-5xl">
                一个 Agent，按问题动态组织研究与执行。
              </h2>
              <p className="mt-5 max-w-md text-base leading-7 text-[#667085]">
                它先理解上下文，再选择技术指标、衍生品、市场消息、链上数据或策略库。普通问题直接回答；只有明确需要时，才生成代码并启动沙箱回测。
              </p>
              <div className="mt-8 space-y-3 text-sm text-[#475467]">
                <p className="flex items-center gap-2"><Check size={15} className="text-[#12b76a]" /> 多源证据按需并行，不固定串行流程</p>
                <p className="flex items-center gap-2"><Check size={15} className="text-[#12b76a]" /> 实时展示工具动作、成功结果与失败原因</p>
                <p className="flex items-center gap-2"><Check size={15} className="text-[#12b76a]" /> 对话上下文贯穿研究、生成与回测</p>
              </div>
            </div>
            <AgentLoopScene />
          </div>
        </div>
      </section>

      <section id="architecture" className="bg-[#101318] text-white">
        <div className="mx-auto max-w-[1240px] px-5 py-20 md:px-8 md:py-28">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7da7ff]">Evidence-to-execution architecture</p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.025em] md:text-5xl">从外部证据，到可复现的策略产物。</h2>
            <p className="mt-5 text-base leading-7 text-[#aab2c0]">
              Agent 不把模型输出直接当结果。市场判断有数据来源，策略建议有参考依据，代码生成受统一 Schema 约束，最终在隔离沙箱里形成可审计的回测证据。
            </p>
          </div>

          <div className="mt-14 grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 md:grid-cols-5">
            {architecture.map((item, index) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="relative min-h-48 bg-[#101318] p-5 lg:p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid size-9 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-[#7da7ff]">
                      <Icon size={17} />
                    </span>
                    {index < architecture.length - 1 ? <ArrowRight size={15} className="hidden text-[#596273] md:block" /> : null}
                  </div>
                  <p className="mt-8 text-sm font-semibold">{item.label}</p>
                  <p className="mt-2 text-xs leading-5 text-[#8993a3]">{item.detail}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-white/10 pt-7 text-xs text-[#8993a3]">
            <span className="inline-flex items-center gap-2"><Bot size={14} /> Microsoft Agent Framework</span>
            <span className="inline-flex items-center gap-2"><Database size={14} /> Bitget MCP + public research data</span>
            <span className="inline-flex items-center gap-2"><FileJson2 size={14} /> Pydantic typed schema</span>
            <span className="inline-flex items-center gap-2"><TerminalSquare size={14} /> Python Sandbox</span>
            <span className="inline-flex items-center gap-2"><Braces size={14} /> Next.js</span>
          </div>
        </div>
      </section>

      <section className="bg-[#f7f8fa]">
        <div className="mx-auto grid max-w-[1240px] gap-8 px-5 py-20 md:grid-cols-[1fr_auto] md:items-end md:px-8 md:py-24">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#e5484d]">Build, test, keep</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.025em] md:text-5xl">
              把一个市场想法，变成可以继续迭代的策略资产。
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#667085]">
              研究与沙箱环境，仅用于策略探索和验证，不会提交真实交易订单。
            </p>
          </div>
          <Link href="/strategy-lab" className="inline-flex h-12 w-fit items-center gap-2 rounded-md bg-[#e5484d] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#cf3f44]">
            Open Strategy Lab <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-black/[0.07] bg-white">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-5 py-7 text-xs text-[#7b8494] sm:flex-row sm:items-center sm:justify-between md:px-8">
          <div className="flex items-center gap-2 font-semibold text-[#344054]">
            <Braces size={14} /> PaperForge
          </div>
          <p>Bitget AI Hackathon 2026 · Research and sandbox use only</p>
        </div>
      </footer>
    </main>
  );
}
