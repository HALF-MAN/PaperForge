# PaperForge Agent 设计模式调研与落地方案

## 1. 背景

当前 PaperForge 已经具备策略选择、结构化 Strategy Spec、Bitget 行情回测、风险评分、模拟盘、人工审批和实盘 dry-run 的基础流程。

但现阶段体验更像一个固定交易系统，而不是一个真正的多 Agent 工作台。用户看到了状态变化，却很少看到：

- Agent 看到了什么证据
- Agent 如何做判断
- Agent 调用了哪些工具
- Agent 为什么把任务交给下一个 Agent
- Agent 如何根据结果反思并生成新版本策略

因此下一阶段的重点不是继续堆流程节点，而是让 PaperForge 具备“可观察的 Agent 推理与协作体验”。

## 2. 调研对象与可借鉴模式

### 2.1 Agent Skill Registry：能力可发现、可复用

参考对象：

- SkillsMD: https://skillsmd.dev/
- SkillHub / SkillRouter / askill 等 Agent Skill Registry
- Bitget Agent Hub 的 Tools、Skill Hub、MCP Server

这些项目的共同点是：Agent 不只是聊天，它有一组明确、可调用、可复用的技能。

对 PaperForge 的启发：

PaperForge 应该把能力显式建模成 Tool / Skill，而不是隐藏在流程代码里。

建议第一批 Tool：

| Tool | 作用 | 调用方 |
| --- | --- | --- |
| `compile_strategy_spec` | 把模板或自然语言策略转为结构化 Spec | Strategy Agent |
| `fetch_market_candles` | 拉取 Bitget K 线 | Backtest Agent |
| `run_backtest` | 执行历史回测 | Backtest Agent |
| `score_risk` | 计算风险评分与阻断项 | Risk Agent |
| `start_paper_session` | 启动模拟盘 | Demo Agent |
| `generate_review_report` | 汇总证据与上线建议 | Review Agent |
| `request_human_approval` | 暂停并请求人工审批 | Human Supervisor |
| `prepare_live_dry_run` | 进入实盘 dry-run 监控 | Live Agent |

UI 上不要只展示“PASS / WARN / ACTIVE”，而要展示：

```text
Backtest Agent called run_backtest()
Input: BTCUSDT, 1h, 300 candles
Output: totalReturn=-0.1%, trades=1, maxDrawdown=0.1%
```

这会让项目从“交易面板”变成“Agent 工具编排系统”。

### 2.2 Org Studio：角色、边界与交接

参考对象：

- Org Studio: https://orgstudio.dev/

Org Studio 的核心不是把所有任务丢给一个 Agent，而是给每个 Agent 明确：

- Mission：它负责什么
- Domain boundary：它不能做什么
- Feedback loop：它如何根据结果调整
- Handoff：它什么时候把任务交给下一个 Agent

对 PaperForge 的启发：

每个 Agent 应该有明确职责边界：

| Agent | Mission | 不允许做的事 |
| --- | --- | --- |
| Strategy Agent | 生成或修正 Strategy Spec | 不直接下单 |
| Backtest Agent | 获取行情并跑回测 | 不判断是否上线 |
| Risk Agent | 识别风险、给出 PASS/WARN/BLOCK | 不绕过人工审批 |
| Demo Agent | 跑模拟盘并记录订单 | 不触发真实交易 |
| Review Agent | 生成上线审查报告 | 不修改交易参数 |
| Human Supervisor | 批准、拒绝或要求修改 | 无 |
| Live Agent | 只执行已批准版本的 dry-run / live | 不接受未审批策略 |

UI 上应该强化“交接”：

```text
Strategy Agent -> Backtest Agent
Reason: Spec schema validated. Historical evidence required before risk review.
```

这比固定流水线更有 Agent 协作感。

### 2.3 LangGraph / 多 Agent Graph：状态驱动与条件路由

参考对象：

- LangGraph multi-agent collaboration examples
- TradingAgents 类交易研究多 Agent 项目

LangGraph 的核心模式是把 Agent 工作流建模为图：

```text
node = Agent / Tool
edge = 条件跳转
state = 当前上下文
interrupt = 人类审批或外部等待
```

PaperForge MVP 可以继续用 TypeScript 轻量状态机，不必立刻引入 LangGraph。但设计上应该借鉴 Graph 思路：

```text
Strategy
  -> Backtest
  -> Risk
    -> PASS: Demo
    -> WARN: Reflect / Human Review
    -> BLOCK: Strategy Revision
  -> Paper Trading
  -> Review
  -> Human Approval
    -> approve: Live Dry-Run
    -> changes_requested: Strategy Revision
    -> reject: Stop
```

重点不是“所有节点都跑一遍”，而是根据证据条件路由。

### 2.4 Human-in-the-loop：高风险动作必须可中断

参考对象：

- LangGraph Approval Hub
- Deliberate / approval layer 类项目
- 多 Agent 人类审批讨论中的 common pattern：pause -> approve/reject -> resume

交易是高风险场景，不能只在最后放一个 Approve 按钮。更合理的方式是把人工审批放在关键动作之前：

| 触发点 | 是否需要人类介入 | 原因 |
| --- | --- | --- |
| 自然语言生成 Strategy Spec | 可选 | 用户确认策略理解是否正确 |
| 风险评分 WARN | 建议 | 让用户决定是否接受修改 |
| 模拟盘表现异常 | 必须 | 防止进入实盘 |
| 实盘 dry-run -> live | 必须 | 真实资金动作 |
| 参数变更后重新上线 | 必须 | 防止 Agent 自行扩大风险 |

PaperForge 的核心安全叙事：

> Agent 可以推进流程，但不能越过门禁；真实交易权限必须由人类显式授予。

### 2.5 Agent Observability：让后台工作可感知

参考对象：

- multi-agent observability / visibility tool 类项目
- AutoGen Studio 对多 Agent 调试的可视化理念

用户现在觉得“不 AI”，根因不是没有更多按钮，而是看不到 Agent 的后台思考和协作。

建议新增 `Agent Transcript` 面板，记录每个 Agent 的：

```text
Observation: 我看到了什么
Reasoning: 我为什么这样判断
Action: 我调用了什么工具
Result: 工具返回了什么关键证据
Handoff: 我把任务交给谁，原因是什么
```

示例：

```text
Risk Agent
Observation: 回测只产生 1 笔交易，样本不足；最大仓位 20%，kill switch 12%。
Reasoning: 收益和回撤都无法证明策略稳定，且首轮上线仓位偏高。
Action: called score_risk()
Result: PASS 88/100, but confidence=low due to sample size.
Handoff: 建议 Demo Agent 先跑 paper session，同时生成 safer v2。
```

这个模式应该成为下一轮 UI 的中心。

### 2.6 ClawPort：Agent Command Center 形态

参考对象：

- ClawPort: https://www.clawport.dev/
- ClawPort Best Practices: https://www.clawport.dev/best-practices
- ClawPort Blog - Taming Agent Sprawl: https://www.clawport.dev/blog/taming-agent-sprawl

ClawPort 的定位是 AI Agent Command Center。它不是单个 Agent 的聊天窗口，而是一个管理 Agent 团队的控制台。官方页面强调的核心模块包括：

- Org Map：可视化 Agent 层级、状态、能力和上下文
- Agent Chat：可以直接和任意 Agent 对话、反馈、纠偏
- Kanban Board：任务队列、进行中、已完成的状态管理
- Cron Pipelines：定时 Agent 任务、DAG、执行历史和失败告警
- Cost Dashboard：模型成本和资源消耗
- Activity Console：实时日志流
- Memory Browser：浏览 Agent 记忆和团队知识库

对 PaperForge 的启发非常直接：我们现在不应该只做一个“交易策略页面”，而应该做一个“交易 Agent 发布指挥中心”。

#### 2.6.1 Org Map -> Trading Agent Org Map

ClawPort 的 Best Practices 推荐三层 Agent 层级：

```text
Orchestrator
  -> Team Lead
    -> Specialist
```

PaperForge 可以借鉴为：

```text
Launch Orchestrator
  -> Research Lead
    -> Market Context Agent
    -> Strategy Agent
  -> Validation Lead
    -> Backtest Agent
    -> Risk Agent
    -> Demo Agent
  -> Release Lead
    -> Review Agent
    -> Human Supervisor
    -> Live Agent
```

这比当前线性流程更有组织感。页面上可以用 Org Map 展示：

- 当前由哪个 Agent 接管
- 哪些 Agent 已完成
- 哪些 Agent 被锁定
- 哪些 Agent 需要人类输入
- 每个 Agent 有哪些工具权限

#### 2.6.2 SOUL.md -> Agent Profile / Operating Rules

ClawPort 里每个 Agent 有类似 `SOUL.md` 的角色文档，用来定义：

- Identity：Agent 是谁
- Expertise：擅长什么
- Operating Rules：硬约束
- Relationships：向谁汇报、和谁协作
- Memory：长期记忆放在哪里

PaperForge 可以改成每个交易 Agent 都有一张 Profile：

```text
Risk Agent

Identity:
  I am the deployment gatekeeper for trading strategies.

Expertise:
  Position sizing, leverage, drawdown, stop loss, kill switch.

Operating Rules:
  - Never approve real order execution.
  - Must block strategies without stop loss.
  - Must require human approval for WARN or live dry-run.

Relationships:
  Receives Backtest Report from Backtest Agent.
  Sends Risk Report to Demo Agent or Strategy Agent.

Memory:
  Stores recurring risk issues and accepted launch thresholds.
```

这能让比赛评委更容易理解：PaperForge 的 Agent 不是简单标签，而是有职责、边界和约束的角色。

#### 2.6.3 Kanban -> Strategy Release Board

ClawPort 的 Kanban Board 用于管理 Agent 团队的任务状态。

PaperForge 可以把策略上线过程改成 Strategy Release Board：

```text
Ideas
  - User custom BTC EMA strategy

Spec Drafted
  - EMA Trend Breakout v1

Backtesting
  - BTCUSDT 1h, Bitget candles

Needs Revision
  - Position too high, sample too small

Paper Trading
  - Demo session active

Awaiting Human Approval
  - Review report ready

Live Dry-Run
  - Execution disabled, monitor only
```

这样用户看到的不再是“固定流程”，而是一个策略发布生命周期。

#### 2.6.4 Activity Console -> Audit Stream

ClawPort 的 Activity Console 是实时日志流。PaperForge 应该把现在右侧的 Agent Log 升级为 Audit Stream：

```text
10:21:03 Strategy Agent called compile_strategy_spec()
10:21:04 Zod validated StrategySpec(spec-ema-v1)
10:21:05 Backtest Agent called fetch_market_candles(BTCUSDT, 1h)
10:21:06 Backtest Agent called run_backtest()
10:21:07 Risk Agent called score_risk()
10:21:08 Risk Agent emitted WARN
10:21:09 Human approval required before live dry-run
```

这个日志不应该只是展示文案，而应该成为项目的核心 Infra 能力：

- 每一步可审计
- 每一步可复盘
- 每一步能还原输入输出
- 每一步能证明没有绕过人类审批

#### 2.6.5 Memory Browser -> Strategy Memory / Risk Memory

ClawPort 强调 Memory Browser 和 team-memory。它的 `SCRIBE` 模式会把原始日志压缩成长期可用的洞察，丢弃会话噪音。

PaperForge 可以借鉴为：

```text
Strategy Memory:
  - 哪些策略模板表现稳定
  - 哪些参数组合被用户接受
  - 哪些市场周期不适合某策略

Risk Memory:
  - 常见风险问题
  - 被人类拒绝的上线原因
  - 被批准的最大仓位和止损边界

Review Memory:
  - 每次上线前的审查结论
  - 用户修改意见
  - 策略版本历史
```

这会自然支持用户之前提到的“如果用户选择沉淀，可以作为固定策略保存下来”。

#### 2.6.6 Least Privilege -> Agent 权限矩阵

ClawPort Best Practices 强调 least privilege：每个 Agent 只能拿到完成任务所需的工具。

PaperForge 应该显式展示 Agent 权限矩阵：

| Agent | Read Market | Backtest | Paper Order | Live Order | Modify Spec | Human Gate |
| --- | --- | --- | --- | --- | --- | --- |
| Strategy Agent | 是 | 否 | 否 | 否 | 是 | 否 |
| Backtest Agent | 是 | 是 | 否 | 否 | 否 | 否 |
| Risk Agent | 是 | 否 | 否 | 否 | 建议修改 | 是 |
| Demo Agent | 是 | 否 | 是，仅模拟 | 否 | 否 | 否 |
| Review Agent | 是 | 读报告 | 否 | 否 | 否 | 是 |
| Human Supervisor | 是 | 是 | 是 | 审批 | 是 | 是 |
| Live Agent | 是 | 否 | 否 | 仅已审批策略 | 否 | 必须 |

这会把 PaperForge 和普通 Trading Bot 拉开差距：它不是“让 AI 自动交易”，而是“交易 Agent 的权限、审计和发布基础设施”。

### 2.7 AgentPilot / Alpha Agent / CodePilot：Agent 有自己的工作台和发言

参考对象：

- AgentPilot: https://agentpilot.ai/
- Alpha Agent Desktop: https://alphaagent.app/desktop
- CodePilot: https://github.com/op7418/CodePilot
- AgentPilot 相关介绍：桌面端多 Agent 创建、管理和对话

这类产品的共同点是：

- 支持多模型 / 多 Provider
- 有统一桌面或 Web 控制台
- Agent 可以接 MCP / tools / skills
- 用户通过聊天、任务列表或工作区控制 Agent
- workflow 可编辑、可重跑
- messages、tools、code 都可以被修改后重新执行
- 支持 branching chat，而不是一条线性对话走到底
- 支持 structured output，让模型输出可以进入工程化 schema

对 PaperForge 的启发：

- 模型 Provider 应该可切换：DashScope、OpenAI-compatible、Mock
- Agent Workspace 应该有“对某个 Agent 单独提问”的入口
- 用户应该能看到 Agent 正在使用哪些工具
- 不同 Agent 可以使用不同模型：Flash 做日志总结，Plus 做结构化生成，Max 做复杂风险反思
- Strategy Agent 不应只是按钮输出结果，而应该有自己的工作台
- Backtest Agent 应该能重跑某一次回测，保留不同 run 的对比
- Risk Agent 的建议应该可以被用户编辑、接受、拒绝，然后生成新策略版本

对 UI 的具体启发：

```text
Agent Workspace
  Strategy Agent:
    - What I read
    - Tool calls
    - Draft Strategy Spec
    - User corrections
    - Re-run from here

  Backtest Agent:
    - Input candles
    - Backtest config
    - Metrics
    - Re-run with different date range

  Risk Agent:
    - Risk findings
    - Proposed patch
    - Accept patch / reject patch / ask why
```

这能解决用户现在的感受：页面不是只显示状态，而是展示每个 Agent “读到了什么、调用了什么工具、为什么这么判断”。

### 2.7.1 Agent 发言不是日志，而是可操作的工作单元

PaperForge 应该区分三类信息：

| 类型 | 示例 | 用途 |
| --- | --- | --- |
| Agent Message | “我发现回测样本不足” | 解释和协作 |
| Tool Call | `run_backtest(spec, candles)` | 可审计、可重跑 |
| Artifact | Strategy Spec、Backtest Report、Risk Patch | 可保存、可版本化 |

AgentPilot 类产品的价值不是“能聊天”，而是把聊天、工具和产物放在同一个可编辑工作流里。PaperForge 应该沿这个方向走。

### 2.7.2 Workflow 可编辑、可重跑

现在 PaperForge 的流程比较固定：

```text
Strategy -> Backtest -> Risk -> Demo -> Review -> Approval -> Live
```

借鉴 AgentPilot 后，应改成：

```text
任意 Agent 节点都可以从当前上下文重跑：

Backtest Agent:
  - Re-run with 300 candles
  - Re-run with 1000 candles
  - Re-run with custom date range

Risk Agent:
  - Re-score with conservative profile
  - Re-score with aggressive profile

Strategy Agent:
  - Generate safer v2
  - Add volatility filter
  - Remove unsupported rule
```

这样评委能看到 PaperForge 不只是一个 demo 流程，而是一个 Agentic workflow tool。

### 2.7.3 Branching Chat -> 策略版本分支

AgentPilot 的 branching chat 可以借鉴为 Strategy Branching：

```text
EMA Trend Breakout v1
  -> v2 safer position
  -> v2 volatility filter
  -> v2 stricter exit
```

每个分支都有：

- Strategy Spec diff
- Backtest Report
- Risk Report
- Paper Session
- Review conclusion

这和用户之前提出的“用户选择沉淀后保存为固定策略”完全一致。

### 2.8 EpicStaff：可视化 Workflow + 后端可控

参考对象：

- EpicStaff: https://github.com/EpicStaff/EpicStaff

EpicStaff 的重点是用 node-based graphic interface 连接预置模块，同时保留后端控制。它不是只给用户一个黑箱聊天，而是让用户看到模块如何连接。

对 PaperForge 的启发：

- 可以把策略上线流程做成可视化 Workflow Graph
- 每个节点是 Agent 或 Tool
- 每条边有条件，例如 `riskScore >= 80 -> paper`，`riskScore < 60 -> revise`
- 未来允许开发者接入自己的 Agent 节点

示例：

```text
Strategy Spec Node
  -> Backtest Node
  -> Risk Node
    -> PASS: Paper Node
    -> WARN: Revise Node + Paper Node
    -> BLOCK: Stop / Strategy Revision
```

这符合 Bitget 赛道二“让别人的 Agent 跑起来”的定义。

### 2.8.1 LangConfig：Visual workflow canvas 适合后期，不是第一优先级

参考对象：

- LangConfig: https://www.langconfig.com/

LangConfig 的定位是可视化 LangChain / LangGraph agent workflow builder。公开页面强调：

- Visual Workflow Canvas：拖拽 Agent，连接 workflow
- Live execution streaming：看 Agent 实时思考和执行
- Interactive tool inspection：查看工具选择、输入输出
- Human-in-the-loop：基于 LangGraph interrupt 的审批点
- Multi-Agent patterns：Supervisor / Swarm
- Local-first：数据留在本地
- Export to code：可导出生产代码

对 PaperForge 的启发：

Visual workflow canvas 可以做，但不是第一优先级。我们现在更需要：

1. Agent 过程可感知
2. 每一步工具调用可审计
3. Human approval 真正成为 workflow interrupt
4. Strategy version 可比较、可回放

后期可以增加 Canvas View：

```text
Canvas View:
  [Strategy Agent] -> [Backtest Agent] -> [Risk Agent]
                                     -> PASS -> [Demo Agent]
                                     -> WARN -> [Revise Agent]
                                     -> BLOCK -> [Stop]
```

但 MVP 里建议先做：

- Agent Workspace
- Activity / Audit Stream
- Strategy Release Board
- Evidence Pack

Canvas 可以作为第二层视图，而不是首页主视图。

### 2.8.2 LangConfig / Langflow / Visual Builder 的共性

这类可视化 builder 的共性是：

- 节点表示 Agent / Tool / Prompt / Data
- 边表示状态流转或条件路由
- 可以测试单个节点
- 可以查看运行时输入输出
- 可以导出代码或配置

PaperForge 不需要照搬通用 builder，而应该做垂直化交易版本：

```text
Trading Workflow Nodes:
  - Strategy Spec Node
  - Market Data Node
  - Backtest Node
  - Risk Gate Node
  - Paper Trading Node
  - Human Approval Node
  - Live Dry-Run Node

Trading Conditions:
  - riskScore >= 80
  - maxDrawdownPct <= threshold
  - paperPnL >= min target
  - humanApproval == approved
```

评委会更容易理解：这是交易 Infra，不是又一个泛用 Agent builder。

### 2.9 Agent Replay / Observability：本地优先的回放与评估

参考对象：

- Agent Replay: https://github.com/agentreplay/agentreplay

Agent Replay 这类项目强调本地优先、观测、记忆和 eval。对交易 Agent 来说，这个方向很重要。

PaperForge 可以借鉴：

- 每次策略发布都是一个可回放的 Run
- 可以重放 Agent 当时看到了什么、调用了什么工具、生成了什么报告
- 可以对比不同模型或不同策略版本的输出质量
- 可以构建 eval：模型是否胡说了不存在的 RSI、是否绕过了审批、是否建议真实交易

这正好对应我们刚遇到的问题：模型说了不存在的 RSI filter。后续应该把这类问题变成自动检测项。

### 2.10 LangGraph Trace Visibility：Workflow 需要执行轨迹，不只看最终结果

参考对象：

- Reddit: Built an open-source LangGraph support triage workflow with trace visibility
- Repo: https://github.com/Tokvera/langgraph-ticket-triage
- Blog: https://tokvera.org/blog/langgraph-support-triage-workflow-trace-visibility

这个示例的重点不是 support triage 本身，而是 trace visibility。它强调用户不应该只看到 workflow 最终跑完，而应该看到：

- 每个节点为什么这样分类
- 为什么路由到某个队列
- 是否触发升级逻辑
- 每个节点生成了什么摘要
- graph-level 和 node-level trace

PaperForge 可以直接迁移这个思想：

```text
Trace View for PaperForge Run:

Run: run_ema_trend_breakout

Node: Strategy Agent
  Input: library template
  Output: StrategySpec
  Validation: Zod pass

Node: Backtest Agent
  Input: StrategySpec + Bitget candles
  Output: BacktestReport
  Decision: enough evidence? false/true

Node: Risk Agent
  Input: StrategySpec + BacktestReport
  Output: RiskReport
  Decision: WARN

Node: Demo Agent
  Input: Approved paper config
  Output: Paper orders
```

这能把 PaperForge 从“状态面板”提升为“可调试的 Agent workflow”。

### 2.10.1 PaperForge Trace 数据结构建议

后续可以把每个 run 存成：

```ts
type AgentTrace = {
  runId: string;
  nodeId: string;
  agent: string;
  startedAt: string;
  endedAt: string;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  toolCalls: ToolCallTrace[];
  decision?: {
    label: "PASS" | "WARN" | "BLOCK" | "WAITING_APPROVAL";
    reason: string;
  };
  handoff?: {
    to: string;
    reason: string;
  };
};
```

这样后面可以支持：

- replay
- debug
- compare runs
- model eval
- audit export

### 2.11 Human Approval 是一等公民，不是普通按钮

参考对象：

- Reddit: I built an open-source approval layer for LangGraph agents
- Deliberate: https://github.com/beomwookang/deliberate
- LangGraph `interrupt()` 思路

这个模式和 PaperForge 非常贴。它的核心观点是：`interrupt()` 只能暂停 graph，但生产系统还需要：

- 通知正确审批人
- 展示专门的 approval UI
- 支持 timeout
- 记录审计日志
- 审批后恢复 graph

PaperForge 现在有 Approve Dry-Run 按钮，但它还不够像“审批系统”。应该升级为 Approval Gate：

```text
Approval Request:
  Requested by: Review Agent
  Purpose: Allow Live Agent to enter live dry-run
  Risk status: WARN
  Evidence:
    - Strategy Spec
    - Backtest Report
    - Risk Report
    - Paper Session
  Required checks:
    - Real order execution disabled
    - Max position <= 15%
    - Kill switch armed
  Decision:
    - Approve
    - Request changes
    - Reject
  Audit:
    - approver
    - timestamp
    - reason
```

### 2.11.1 Approval Gate 的产品价值

这会成为 PaperForge 的核心差异点：

普通交易 Bot：

```text
模型生成策略 -> 自动下单
```

PaperForge：

```text
Agent 生成策略 -> 证据收集 -> 风险审查 -> 模拟盘 -> 审批请求 -> 人类决策 -> dry-run / live
```

这不仅更安全，也更符合 Bitget 赛道二“交易 Infra”的定位。

### 2.12 Org Studio：多 Agent 是组织结构，不是流水线节点

参考对象：

- Org Studio: https://orgstudio.dev/

用户截图里提到的重点是正确的：多 Agent 不应该只是流水线节点，而应该像一个组织。

PaperForge 当前的节点：

```text
Strategy / Backtest / Risk / Demo / Review / Approval / Live
```

如果只做成横向卡片，会像普通系统流程。Org Studio / ClawPort 的启发是：

```text
Agent Organization:

Launch Orchestrator
  - owns the full release
  - decides next agent
  - pauses for approval

Strategy Desk
  - Strategy Agent
  - Market Context Agent
  - Spec Validator

Validation Desk
  - Backtest Agent
  - Risk Agent
  - Demo Agent

Release Desk
  - Review Agent
  - Human Supervisor
  - Live Agent
```

页面可以围绕“Desk”设计：

- 左侧：Agent Org Map
- 中间：当前 Agent Workspace
- 右侧：Evidence / Memory / Approval
- 底部：Activity Stream

这会比当前的“固定面板 + 状态卡”更像一个真实 Agent 平台。

### 2.13 参考模式总表

| 参考对象 | 可借鉴模式 | PaperForge 落地 |
| --- | --- | --- |
| AgentPilot | Agent workspace、workflow 可编辑、messages/tools/code 可重跑、branching chat | Agent 工作台、策略版本分支、从任意节点重跑 |
| ClawPort | Org Map、Kanban、Activity Console、Memory Browser、agent least privilege | Trading Agent Org Map、Strategy Release Board、Audit Stream、Risk Memory、权限矩阵 |
| Org Studio | Agent team / 上下文 / 任务看板 / 活动日志 | Launch Orchestrator + Strategy / Validation / Release desks |
| LangGraph trace demo | graph-level 和 node-level trace visibility | PaperForge Run Trace、节点输入输出、工具调用轨迹 |
| LangChain approval layer | approval 是 workflow interrupt，不只是按钮 | Approval Request、审计、timeout、恢复 workflow |
| EpicStaff | node-based visual workflow builder | 后期 Canvas View，Agent / Tool 节点可视化 |
| LangConfig | visual canvas、live execution streaming、interactive tool inspection、human-in-loop | Canvas 作为第二层视图，优先做 Agent Workspace 和 Trace |
| Agent Replay | replay、observability、eval | 策略发布回放、模型胡说检测、版本对比 |

### 2.14 对 PaperForge 新平台形态的综合建议

基于上述调研，PaperForge 的新定位可以从：

```text
Multi-agent strategy deployment gate
```

升级为：

```text
Trading Agent Command Center
```

或者中文表达：

```text
交易 Agent 策略发布指挥中心
```

核心产品模块建议：

```text
1. Strategy Intake
   模板策略 / 自定义策略 / 用户沉淀策略

2. Agent Org Map
   展示 Agent 组织、权限、当前接管者

3. Agent Workspace
   展示当前 Agent 的观察、推理、工具调用、产物、可编辑建议

4. Strategy Release Board
   类 Kanban 展示策略从 idea 到 live dry-run 的生命周期

5. Evidence Pack
   Strategy Spec / Backtest / Risk / Paper / Review

6. Approval Gate
   真正的审批请求，不只是按钮

7. Activity / Audit Stream
   所有 Agent 和 Tool 调用可追踪

8. Memory Browser
   策略库、风险记忆、用户批准/拒绝历史

9. Replay & Eval
   回放一次策略发布，检测模型幻觉和违规建议
```

下一版页面不建议继续扩大当前三栏信息密度，而应该重构为：

```text
顶部：Run / Market / Model / Risk / Approval 状态
左侧：Agent Org Map + Strategy Release Board
中间：当前 Agent Workspace
右侧：Evidence Pack + Approval Request
底部：Activity Stream / Trace Timeline
```

这能让评委一眼看懂：PaperForge 是让交易 Agent 安全上线的基础设施，而不是普通交易面板。

## 3. PaperForge 应该采用的产品模式

### 3.1 从 Pipeline View 改成 Agent Workspace

当前页面中心是 Pipeline，下一版建议改成：

```text
左侧：Strategy Intake
中间：Agent Workspace
右侧：Evidence / Spec / Approval
底部或侧栏：Tool Calls & Audit Log
```

`Agent Workspace` 是主角，而不是 Pipeline 卡片。

核心体验：

1. 用户选择模板或输入自然语言策略
2. Strategy Agent 解释它如何理解策略
3. Backtest Agent 自动调用行情和回测工具
4. Risk Agent 给出风险判断和修改建议
5. Demo Agent 接管模拟盘
6. Review Agent 生成上线报告
7. Human Supervisor 做最终审查
8. Live Agent 只接收已审批版本

### 3.2 从一次性流程改成 Plan -> Act -> Reflect

推荐把 PaperForge 的特色定义为：

> A multi-agent launch gate that turns a trading idea into an auditable, iterated, human-approved strategy release.

也就是：

```text
Plan: 生成策略 v1
Act: 回测 / 模拟盘
Reflect: 发现样本不足、风险过高、收益不稳定
Revise: 自动生成 v2
Approve: 人类审查
Launch: dry-run / live
Monitor: 持续观察
```

这比“跑完一条流水线”更像 Agent。

### 3.3 两类策略入口

PaperForge 仍然保留两个入口：

#### 固定沉淀策略

适合 Demo 和用户推荐：

- 模板经过工程验证
- 输出稳定 Strategy Spec
- 更容易解释和审计
- 更适合比赛演示

#### 用户自定义策略

适合展示 AI 特色：

- 用户用自然语言描述策略
- LLM 生成 Strategy Spec
- Zod 校验
- 必要时生成代码，但必须进入沙箱
- 表现好的策略可以沉淀进 Strategy Library

这两类入口最终进入同一个 Agent Launch Gate。

## 4. 阿里云大模型接入方案

用户已经申请阿里云大模型 API Key，可以作为 PaperForge 的 LLM Provider。

### 4.1 推荐接入方式

优先使用阿里云百炼 / DashScope 的 OpenAI-compatible API。

官方文档显示，百炼支持 OpenAI 兼容接口，常用环境变量为：

```bash
DASHSCOPE_API_KEY=your-api-key
```

中国内地北京地域常用 base URL：

```text
https://dashscope.aliyuncs.com/compatible-mode/v1
```

国际新加坡地域常用 base URL：

```text
https://dashscope-intl.aliyuncs.com/compatible-mode/v1
```

建议 `.env.local` 增加：

```bash
LLM_PROVIDER=dashscope
DASHSCOPE_API_KEY=your-api-key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=qwen-plus
```

注意：不要提交真实 API Key。

### 4.2 Provider 抽象

建议实现统一接口：

```ts
export interface LlmProvider {
  generateText(input: LlmTextInput): Promise<string>;
  generateJson<T>(input: LlmJsonInput<T>): Promise<T>;
}
```

Provider 实现：

| Provider | 用途 |
| --- | --- |
| `MockLlmProvider` | 无 Key 时稳定演示和测试 |
| `DashScopeProvider` | 接入阿里云百炼 / 通义千问 |
| `OpenAICompatibleProvider` | 后续兼容其他模型服务 |

第一阶段建议先做 `MockLlmProvider + DashScopeProvider`。

### 4.3 LLM 首批使用场景

不要一开始让 LLM 控制交易。第一批只让它做低风险、可校验的事情：

| 场景 | 是否适合首批接入 | 原因 |
| --- | --- | --- |
| 自然语言策略 -> Strategy Spec | 适合 | 可用 Zod 校验 |
| Agent Transcript 生成 | 适合 | 不直接影响交易 |
| 风险解释与修改建议 | 适合 | 人类可审查 |
| Review Report 生成 | 适合 | 汇总证据 |
| 直接生成并执行交易代码 | 暂缓 | 必须先有沙箱 |
| 自动实盘下单 | 暂缓 | 必须通过审批门禁 |

### 4.4 LLM 输出必须被约束

所有 LLM 生成的结构化内容必须经过：

1. JSON schema / Zod 校验
2. 策略字段白名单
3. 风险参数上限
4. 人类可读 diff
5. 审计日志记录

示例：

```text
LLM 允许建议：
- maxPositionPct: 0.2 -> 0.1
- add volatility filter

LLM 不允许直接执行：
- place_order()
- change_leverage()
- withdraw()
```

## 5. 下一步落地优先级

### P0：让页面立刻有 Agent 感

目标：不改变交易能力，先改变用户感知和系统结构。

任务：

- 新增 `Agent Transcript` 数据结构
- 每个 Agent 输出 Observation / Reasoning / Action / Result / Handoff
- UI 中把 Agent Workspace 作为主区域
- Tool Call Log 显示每一步调用的工具和输入输出摘要
- 保留原 Pipeline，但弱化为状态摘要

### P1：接入阿里云大模型

目标：让 Strategy Agent / Review Agent 真实调用 LLM。

任务：

- 增加 `.env.example` 中的 DashScope 配置项
- 实现 `src/llm/provider.ts`
- 实现 `src/llm/dashscope-provider.ts`
- 实现 `src/llm/mock-provider.ts`
- 新增 `/api/agents/strategy` 或 `/api/llm/strategy-spec`
- LLM 输出 Strategy Spec 后必须 Zod 校验

### P2：Reflect & Revise 策略迭代

目标：让 Risk Agent 不只是打分，还能提出 v2。

任务：

- 根据风险报告生成 safer v2
- 显示 v1 -> v2 参数 diff
- 用户可选择接受修改、重新回测或保存到策略库
- 保存策略版本历史

### P3：沙箱与代码生成

目标：支持更自由的用户自定义策略。

任务：

- 只允许在沙箱中运行生成代码
- 限制可访问 API
- 限制执行时间和资源
- 输出回测报告，不允许直接交易

## 6. 建议的 Demo 叙事

3 分钟演示可以这样讲：

1. 用户选择 EMA 趋势策略或输入自然语言策略
2. Strategy Agent 生成结构化 Spec，并解释理解结果
3. Backtest Agent 调用 Bitget 行情，跑历史回测
4. Risk Agent 发现样本不足或仓位偏高，提出 safer v2
5. 用户接受修改，系统重新回测
6. Demo Agent 启动模拟盘，输出订单和 PnL
7. Review Agent 汇总上线报告
8. Human Supervisor 审批
9. Live Agent 进入 dry-run，真实交易仍默认禁用

核心卖点：

> PaperForge 不是一个自动交易 Bot，而是交易 Agent 进入真实资金前的多 Agent 发布门禁。

## 7. 结论

PaperForge 下一阶段最应该借鉴的不是某一个完整框架，而是四个设计模式：

1. Skill / Tool Registry：Agent 能力显式化
2. Agent Transcript：推理过程可观察
3. Human-in-the-loop：高风险动作可中断、可审批
4. Plan -> Act -> Reflect：策略自动迭代，但人类最终控制

阿里云大模型 API Key 已经具备后，可以优先接入 Strategy Agent 和 Review Agent，让系统从“固定流程”升级为“Agent 驱动的策略发布工作台”。

## 8. 参考资料

- Bitget Agent Hub: https://www.bitget.com/activity-hub/agent-hub
- AgentPilot: https://agentpilot.ai/
- ClawPort: https://www.clawport.dev/
- ClawPort Best Practices: https://www.clawport.dev/best-practices
- ClawPort Blog - Taming Agent Sprawl: https://www.clawport.dev/blog/taming-agent-sprawl
- Org Studio: https://orgstudio.dev/
- SkillsMD Agent Integrations: https://skills.md/docs/agents
- SkillsMD Skill Discovery: https://skills.md/docs/skills
- Alpha Agent Desktop: https://alphaagent.app/desktop
- CodePilot: https://github.com/op7418/CodePilot
- EpicStaff: https://github.com/EpicStaff/EpicStaff
- LangConfig: https://www.langconfig.com/
- Agent Replay: https://github.com/agentreplay/agentreplay
- LangGraph Human-in-the-loop: https://langchain-ai.lang.chat/langgraph/tutorials/get-started/4-human-in-the-loop/
- LangGraph JS Human-in-the-loop concepts: https://langchain-ai.lang.chat/langgraphjs/concepts/human_in_the_loop/
- LangGraph support triage trace demo: https://github.com/Tokvera/langgraph-ticket-triage
- LangGraph trace visibility blog: https://tokvera.org/blog/langgraph-support-triage-workflow-trace-visibility
- Reddit LangGraph support triage discussion: https://www.reddit.com/r/LangGraph/comments/1s4xp6y/built_an_opensource_langgraph_support_triage/
- Deliberate approval layer: https://github.com/beomwookang/deliberate
- Reddit LangChain approval layer discussion: https://www.reddit.com/r/LangChain/comments/1stjyz2/i_built_an_opensource_approval_layer_for/
- 阿里云百炼 OpenAI 兼容接口: https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
- 阿里云百炼 Model Studio 概览: https://help.aliyun.com/zh/model-studio/what-is-model-studio
