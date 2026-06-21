"use client";

import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  Cpu,
  FileText,
  Lock,
  PlayCircle,
  ScrollText,
  Terminal,
  TriangleAlert,
  UsersRound,
  Workflow,
  X
} from "lucide-react";
import { MissionRunner } from "@/src/components/platform/mission-runner";
import { StatusPill } from "@/src/components/platform/ui";
import { WorkflowGraph } from "@/src/components/platform/workflow-graph";
import type {
  OrchestratorEvent,
  OrchestratorRun,
  PlatformAgent,
  PlatformArtifact,
  PlatformMission,
  PlatformRunStep
} from "@/src/platform/types";

type InspectorTab = "overview" | "output" | "artifacts" | "logs";
type NodePosition = { x: number; y: number };
type DragState = {
  label: string;
  moved: boolean;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
};

type MissionStudioProps = {
  agents: PlatformAgent[];
  artifacts: PlatformArtifact[];
  autoStart?: boolean;
  canRunNext: boolean;
  initialSelectedStepLabel: string;
  latestRun: OrchestratorRun | null;
  mission: PlatformMission;
  steps: PlatformRunStep[];
  team: PlatformAgent[];
  timeline: OrchestratorEvent[];
};

const artifactTypesByStep: Record<string, PlatformArtifact["type"][]> = {
  Intake: ["brief"],
  "Mission Intake": ["brief"],
  "Staffing & Plan": ["team_plan"],
  "Market Data": ["market_data"],
  "Strategy Research": ["strategy_spec"],
  Backtest: ["backtest_report"],
  "Risk Assessment": ["risk_report"],
  "Strategy Review": ["review_report"],
  "Paper Trading": ["paper_session"],
  "Human Approval": ["approval"],
  // Legacy labels
  Staffing: ["team_plan"],
  Spec: ["strategy_spec"],
  Risk: ["risk_report"],
  Paper: ["paper_session"],
  Approval: ["approval"]
};

const canvasSize = { width: 2000, height: 1000 };
const nodeSize = { width: 218, height: 190 };

const graphLayout: Record<string, NodePosition> = {
  Intake: { x: 160, y: 370 }
};

function getNodePosition(label: string, index: number, total: number): NodePosition {
  if (graphLayout[label]) return graphLayout[label];
  return { x: 100 + index * 270, y: 370 };
}

// Match edge from/to by Plan step ID → run step ID (step-{planId})
function findStepByPlanId(steps: PlatformRunStep[], planId: string): PlatformRunStep | undefined {
  // Exact match: step-{planId}
  const exactMatch = steps.find((s) => s.id === `step-${planId}`);
  if (exactMatch) return exactMatch;
  // Fallback: endsWith -{planId}
  return steps.find((s) => s.id.endsWith(`-${planId}`));
}

const graphEdges: Array<[string, string, "normal" | "blocked" | "locked"]> = [];

function buildEdgesFromPlan(plan: { steps: Array<{ id: string; dependsOn: string[] }> }): Array<[string, string, "normal" | "blocked" | "locked"]> {
  const edges: Array<[string, string, "normal" | "blocked" | "locked"]> = [];
  // Connect Intake to first Plan step
  if (plan.steps.length > 0) {
    edges.push(["intake", plan.steps[0].id, "normal"]);
  }
  for (const step of plan.steps) {
    for (const depId of step.dependsOn) {
      edges.push([depId, step.id, "normal"]);
    }
  }
  return edges;
}

export function MissionStudio({
  agents,
  artifacts,
  autoStart = false,
  canRunNext,
  initialSelectedStepLabel,
  latestRun,
  mission,
  steps,
  team,
  timeline
}: MissionStudioProps) {
  const currentStep = steps.find((step) => step.status === "active") ?? steps[0];
  const initialStep = steps.find((step) => step.label === initialSelectedStepLabel) ?? currentStep;
  const [selectedStepId, setSelectedStepId] = useState(initialStep.id);
  const [tab, setTab] = useState<InspectorTab>("overview");
  const [replayIndex, setReplayIndex] = useState(Math.max(0, timeline.length - 1));
  const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>(graphLayout);
  const [detailOpen, setDetailOpen] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moving: boolean } | null>(null);
  const nodeDragRef = useRef<DragState | null>(null);
  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? currentStep;
  const selectedAgent = agents.find((agent) => agent.id === selectedStep.agentId);
  const selectedArtifacts = getArtifactsForStep(selectedStep, artifacts);
  const visibleEvents = timeline.slice(0, replayIndex + 1);
  const replayEvent = timeline[replayIndex];
  const replayStepLabel = replayEvent?.step;
  const workingAgents = agents.filter((a) => a.status === "working" || a.status === "waiting");

  function selectStep(step: PlatformRunStep) {
    setSelectedStepId(step.id);
    setTab("overview");
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  // ── Node dragging ──
  function startNodeDrag(step: PlatformRunStep, event: PointerEvent<HTMLButtonElement>) {
    const idx = steps.findIndex(s => s.id === step.id);
    const position = nodePositions[step.label] ?? getNodePosition(step.label, idx >= 0 ? idx : 0, steps.length);
    const el = event.currentTarget;
    nodeDragRef.current = {
      label: step.label,
      moved: false,
      originX: position.x,
      originY: position.y,
      startX: event.clientX,
      startY: event.clientY
    };
    el.setPointerCapture(event.pointerId);

    // Save original transition and remove it for instant drag
    el.style.transition = "none";
  }

  function moveNode(event: PointerEvent<HTMLButtonElement>) {
    const drag = nodeDragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;

    // Direct DOM update — no React re-render
    event.currentTarget.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function endNodeDrag(step: PlatformRunStep) {
    const drag = nodeDragRef.current;
    if (!drag || drag.label !== step.label) return;
    nodeDragRef.current = null;

    const el = document.querySelector(`[data-step-id="${step.id}"]`) as HTMLElement;
    if (!el) return;

    // Read current transform before clearing
    const transform = el.style.transform;
    el.style.transition = "";
    el.style.transform = "";

    if (!drag.moved) {
      selectStep(step);
      return;
    }

    // Compute final position from drag offset
    const match = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
    const dx = match ? parseFloat(match[1]) : 0;
    const dy = match ? parseFloat(match[2]) : 0;

    setNodePositions(current => ({
      ...current,
      [drag.label]: { x: drag.originX + dx, y: drag.originY + dy }
    }));
  }

  // ── Canvas panning ──
  function startCanvasPan(event: PointerEvent<HTMLDivElement>) {
    // Only pan when clicking empty canvas area (not a node)
    if ((event.target as HTMLElement).closest("button")) return;
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: panOffset.x,
      originY: panOffset.y,
      moving: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCanvasPan(event: PointerEvent<HTMLDivElement>) {
    const p = panRef.current;
    if (!p) return;
    const dx = event.clientX - p.startX;
    const dy = event.clientY - p.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moving = true;
    setPanOffset({ x: p.originX + dx, y: p.originY + dy });
  }

  function endCanvasPan() {
    panRef.current = null;
  }

  function resetLayout() {
    setNodePositions({});
    setPanOffset({ x: 0, y: 0 });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--background)]">
      {/* ═══ Mission Header ═══ */}
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--panel-soft)] px-5 py-2.5 backdrop-blur-xl">
        <Link className="flex items-center gap-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]" href={{ pathname: "/missions" }}>
          <ArrowLeft size={13} aria-hidden />
          Missions
        </Link>
        <span className="h-3 w-px bg-[var(--line)]" />

        <StatusPill tone={mission.status === "blocked" ? "danger" : "accent"}>{mission.status}</StatusPill>
        <StatusPill tone={currentStep.status === "active" ? "accent" : currentStep.status === "warning" ? "warn" : "neutral"}>
          {currentStep.label}
        </StatusPill>
        <StatusPill tone={mission.risk.decision === "BLOCK" ? "danger" : mission.risk.decision === "WARN" ? "warn" : "good"}>
          risk {mission.risk.riskScore}/100
        </StatusPill>
        {mission.plan?.framework === "crewai" ? (
          <StatusPill tone="neutral">CrewAI planner</StatusPill>
        ) : null}

        <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--faint)]">
          {workingAgents.length > 0 && (
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
          )}
          {workingAgents.length > 0
            ? `${workingAgents.length} active`
            : "idle"}
          <span className="mx-1 text-[var(--line-strong)]">·</span>
          {mission.strategy.symbol}
          <span className="mx-1 text-[var(--line-strong)]">·</span>
          {mission.strategy.timeframe}
        </span>

        <MissionRunner
          autoStart={autoStart}
          canRun={canRunNext}
          idleLabel={runnerLabelForMission(mission.status)}
          initialRun={latestRun}
          missionId={mission.id}
          fullWidth={false}
        />
      </header>

      {/* ═══ Pipeline Progress ── reads from Plan ═══ */}
      <PipelineProgress mission={mission} runSteps={steps} />

      {/* ═══ Main: Team Room + Inspector ═══ */}
      <main className="flex min-h-0 flex-1">
        {/* ─── Team Room ─── */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <WorkflowGraph
            agents={agents}
            artifacts={artifacts}
            onSelectStep={selectStep}
            plan={mission.plan}
            selectedStepId={selectedStep.id}
            steps={steps}
          />
        </div>

        {/* ─── Detail Drawer ─── */}
        <DetailDrawer
          agent={selectedAgent}
          artifacts={selectedArtifacts}
          events={timeline}
          mission={mission}
          onClose={closeDetail}
          onSelectAgent={(agent) => {
            const ownedStep = steps.find((step) => step.agentId === agent.id);
            if (ownedStep) {
              setSelectedStepId(ownedStep.id);
              setTab("overview");
            }
          }}
          open={detailOpen}
          selectedTab={tab}
          setSelectedTab={setTab}
          step={selectedStep}
          team={team}
        />
      </main>
    </div>
  );
}

function runnerLabelForMission(status: PlatformMission["status"]) {
  if (status === "planning") return "Plan workflow";
  if (status === "ready") return "Run workflow";
  return "Continue mission";
}

/* ─── Pipeline Progress Bar ─── */
function PipelineProgress({ mission, runSteps }: { mission: PlatformMission; runSteps: PlatformRunStep[] }) {
  const plan = mission.plan;
  if (!plan?.steps.length) return null;

  const steps = plan.steps;

  return (
    <div className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-[var(--line)] bg-[var(--panel-soft)] px-5 py-3">
      {steps.map((step, i) => {
        const runStep = runSteps.find((item) => item.id === `step-${step.id}` || item.id.endsWith(`-${step.id}`));
        const stepStatus = runStep?.status ?? "waiting";
        const isDone = stepStatus === "done";
        const isActive = stepStatus === "active";
        const isWarning = stepStatus === "warning";
        const isLocked = stepStatus === "locked";

        return (
          <div className="flex items-center gap-0" key={step.id}>
            {/* Connector line from previous step */}
            {i > 0 && (
              <div className={`w-8 h-0.5 -mx-1 rounded-full ${
                isDone || isActive ? "bg-[var(--accent)]" : isWarning ? "bg-[var(--warning)]" : "bg-[var(--line-strong)]"
              }`} />
            )}
            <div className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap ${
              isActive
                ? "bg-[var(--accent)]/10 text-[var(--accent-strong)] ring-1 ring-[var(--accent)]/30 shadow-sm"
                : isDone
                  ? "text-[var(--success)]"
                  : isWarning
                    ? "bg-[var(--warning)]/8 text-[var(--warning)]"
                    : isLocked
                      ? "text-[var(--faint)]"
                      : "text-[var(--muted)]"
            }`}>
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                isActive ? "bg-[var(--accent)] text-white" :
                isDone ? "bg-[var(--success)] text-white" :
                isWarning ? "bg-[var(--warning)] text-white" :
                isLocked ? "bg-[var(--faint)] text-white" :
                "bg-[var(--line-strong)] text-white"
              }`}>
                {isDone ? "✓" : isActive ? (i + 1) : isWarning ? "!" : i + 1}
              </span>
              <span>{step.label}</span>
              {isActive && (
                <span className="flex items-center gap-1 ml-0.5 text-[10px] text-[var(--accent)]">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                  running
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GraphEdges({
  edges,
  nodePositions,
  replayStepLabel,
  steps
}: {
  edges: Array<[string, string, "normal" | "blocked" | "locked"]>;
  nodePositions: Record<string, NodePosition>;
  replayStepLabel?: string;
  steps: PlatformRunStep[];
}) {
  const completedLabels = new Set(steps.filter((step) => step.status === "done" || step.status === "active" || step.status === "warning").map((step) => step.label));

  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible pointer-events-none" preserveAspectRatio="none" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}>
      <defs>
        <marker id="arrow-active" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent)" />
        </marker>
        <marker id="arrow-done" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L5,2.5 L0,5 Z" fill="var(--success)" />
        </marker>
        <marker id="arrow-pending" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L5,2.5 L0,5 Z" fill="var(--line-strong)" />
        </marker>
      </defs>
      {edges.map(([from, to, tone]) => {
        const fromStep = findStepByPlanId(steps, from);
        const toStep = findStepByPlanId(steps, to);
        if (!fromStep || !toStep) return null;

        const fromIndex = steps.indexOf(fromStep);
        const toIndex = steps.indexOf(toStep);
        const start = nodePositions[fromStep.label] ?? getNodePosition(fromStep.label, fromIndex >= 0 ? fromIndex : 0, steps.length);
        const end = nodePositions[toStep.label] ?? getNodePosition(toStep.label, toIndex >= 0 ? toIndex : 0, steps.length);
        const fromDone = completedLabels.has(fromStep.label);
        const toDone = completedLabels.has(toStep.label);
        const active = fromDone && toDone;
        const isReplay = replayStepLabel === toStep.label;

        // Horizontal edge: right edge of from-node → left edge of to-node
        const sx = start.x + nodeSize.width;  // right edge
        const sy = start.y + nodeSize.height / 2;  // vertical center
        const ex = end.x;  // left edge
        const ey = end.y + nodeSize.height / 2;
        const mx = (sx + ex) / 2;

        // Gentle horizontal S-curve
        const curve = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`;

        const edgeColor = tone === "blocked" ? "var(--danger)"
          : tone === "locked" ? "var(--faint)"
          : active || isReplay ? "var(--accent)"
          : fromDone ? "var(--success)"
          : "var(--line-strong)";

        const edgeWidth = active || isReplay ? 1.5 : 1;
        const edgeDash = tone === "locked" ? "4 3" : tone === "blocked" ? "6 3" : undefined;
        const markerEnd = active || isReplay ? "url(#arrow-active)" : fromDone ? "url(#arrow-done)" : "url(#arrow-pending)";

        return (
          <path
            key={`${from}-${to}`}
            className={active || isReplay ? "pf-edge-active" : ""}
            d={curve}
            fill="none"
            stroke={edgeColor}
            strokeDasharray={edgeDash}
            strokeLinecap="round"
            strokeWidth={edgeWidth}
            markerEnd={markerEnd}
            style={active || isReplay ? { filter: "drop-shadow(0 0 4px rgba(59,130,246,0.18))" } : undefined}
          />
        );
      })}
    </svg>
  );
}

function getArtifactNameMap(_artifacts: PlatformArtifact[]): Record<string, string> {
  return {};
}

function GraphNode({
  agent,
  artifactCount,
  isWorking,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  position,
  replayFocused,
  selected,
  step
}: {
  agent?: PlatformAgent;
  artifactCount: number;
  isWorking?: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  position: NodePosition;
  replayFocused: boolean;
  selected: boolean;
  step: PlatformRunStep;
}) {
  const tone = step.status === "active" ? (isWorking ? "accent" : "accent")
    : step.status === "done" ? "good"
    : step.status === "warning" ? "warn"
    : step.status === "locked" ? "locked"
    : "neutral";

  const borderRing = isWorking
    ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30 shadow-[0_0_24px_rgba(59,130,246,0.25)]"
    : selected
      ? "border-[var(--accent)] shadow-[0_12px_40px_rgba(59,130,246,0.18)]"
      : "border-[var(--line)] shadow-[var(--shadow-soft)] hover:border-[var(--accent)]/50";

  return (
    <button
      className={`absolute w-[200px] touch-none select-none rounded-[18px] border-2 p-3.5 text-left transition-all duration-300 ${
        step.status === "locked" ? "border-[var(--line)] bg-[var(--panel-muted)] opacity-70" :
        step.status === "warning" && !selected ? "border-[var(--warning)]/40 bg-[var(--warning-soft)]" :
        "bg-[var(--panel)]"
      } ${borderRing} ${isWorking ? "pf-node-working" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-step-id={step.id}
      style={{ left: position.x, top: position.y, transform: "translate(-50%, -50%)" }}
      type="button"
    >
      {/* Top row: avatar + name + status */}
      <div className="flex items-center gap-3">
        <div className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold ${
          tone === "accent" ? "bg-[var(--accent-soft)] text-[var(--accent)]" :
          tone === "good" ? "bg-[var(--success-soft)] text-[var(--success)]" :
          tone === "warn" ? "bg-[var(--warning-soft)] text-[var(--warning)]" :
          "bg-[var(--surface)] text-[var(--muted)]"
        }`}>
          {isWorking ? (
            <>
              <span className="absolute inset-0 animate-ping rounded-lg bg-[var(--accent)]/20" />
              <Cpu size={16} className="relative" />
            </>
          ) : agentInitials(agent?.name ?? "??")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">{step.label}</h3>
            <StatusDot status={step.status} />
          </div>
          <div className="flex items-center gap-1.5">
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{agent?.name ?? "Unassigned"}</p>
            {isWorking ? (
              <span className="rounded-md bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--accent)]">RUNNING</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Tool call: compact */}
      <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px]">
        <Terminal size={11} className="shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="truncate font-mono text-[var(--foreground)]">{step.tool}</span>
        <ArrowRight size={11} className="shrink-0 text-[var(--faint)]" aria-hidden />
        <span className="truncate font-semibold text-[var(--foreground)]">{step.output}</span>
      </div>

      {/* Note: one line only */}
      <p className="mt-2 truncate text-[11px] leading-5 text-[var(--muted)]">{step.note}</p>

      {/* Footer */}
      <div className="mt-2 flex items-center gap-2 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--faint)]">
        {isWorking ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--accent)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            running
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            {step.status === "done" ? <CheckCircle2 size={11} aria-hidden /> :
             step.status === "warning" ? <TriangleAlert size={11} aria-hidden /> :
             step.status === "locked" ? <Lock size={11} aria-hidden /> :
             <Circle size={11} aria-hidden />}
            {step.status}
          </span>
        )}
        <span className="text-[var(--line-strong)]">·</span>
        <FileText size={11} aria-hidden />
        <span>{artifactCount > 0 ? `${artifactCount} artifact${artifactCount > 1 ? "s" : ""}` : "no artifacts"}</span>
      </div>
    </button>
  );
}

function DetailDrawer({
  agent,
  artifacts,
  events,
  mission,
  onClose,
  onSelectAgent,
  open,
  selectedTab,
  setSelectedTab,
  step,
  team
}: {
  agent?: PlatformAgent;
  artifacts: PlatformArtifact[];
  events: OrchestratorEvent[];
  mission: PlatformMission;
  onClose: () => void;
  onSelectAgent: (agent: PlatformAgent) => void;
  open: boolean;
  selectedTab: InspectorTab;
  setSelectedTab: (tab: InspectorTab) => void;
  step: PlatformRunStep;
  team: PlatformAgent[];
}) {
  const stepEvents = events.filter((event) => event.step === step.label || event.agent === agent?.name);
  const planStep = mission.plan?.steps.find((item) => item.id === stepIdFromRunStep(step));

  return (
    <>
      <aside
        className={`fixed right-0 top-0 z-30 flex h-full w-[460px] flex-col border-l border-[var(--line)] bg-[var(--panel)] shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ═══ Agent cockpit header ═══ */}
        <div className="border-b border-[var(--line)] bg-[var(--panel-soft)] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg text-lg font-bold ${
                step.status === "done" ? "bg-[var(--success-soft)] text-[var(--success)]" :
                step.status === "warning" ? "bg-[var(--warning-soft)] text-[var(--warning)]" :
                step.status === "active" ? "bg-[var(--accent-soft)] text-[var(--accent)]" :
                "bg-[var(--surface)] text-[var(--muted)]"
              }`}>
                {agentInitials(agent?.name ?? "??")}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">{step.label}</h2>
                  <StatusPill tone={step.status === "active" ? "accent" : step.status === "warning" ? "warn" : step.status === "done" ? "good" : "neutral"}>
                    {step.status}
                  </StatusPill>
                </div>
                <p className="mt-0.5 text-sm text-[var(--muted)]">{agent?.name ?? "Unassigned agent"}</p>
                <p className="mt-0.5 text-xs text-[var(--faint)]">{agent?.role}</p>
              </div>
            </div>
            <button
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
              onClick={onClose}
              type="button"
            >
              <X size={15} aria-hidden />
            </button>
          </div>

          {/* Quick stats */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Metric label="Tool" value={step.tool} />
            <Metric label="Output" value={step.output} />
            <Metric label="Memory" value={agent?.memoryScope ?? "mission"} />
          </div>
        </div>

        {/* ═══ Scrollable cockpit body ═══ */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Input → Tool → Output flow */}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex items-center gap-3 text-xs">
              <div className="flex flex-1 flex-col gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
                <span className="text-[10px] font-semibold uppercase text-[var(--faint)]">Input</span>
                <span className="font-semibold text-[var(--foreground)]">{step.tool === "task_brief" ? "TaskBrief" : `Artifact from ${getPreviousStep(step.label)}`}</span>
              </div>
              <ArrowRight size={14} className="shrink-0 text-[var(--accent)]" aria-hidden />
              <div className="flex flex-1 flex-col gap-1 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-2">
                <span className="text-[10px] font-semibold uppercase text-[var(--accent)]">Action</span>
                <span className="font-mono text-xs font-semibold text-[var(--accent-strong)]">{step.tool}</span>
              </div>
              <ArrowRight size={14} className="shrink-0 text-[var(--accent)]" aria-hidden />
              <div className="flex flex-1 flex-col gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
                <span className="text-[10px] font-semibold uppercase text-[var(--faint)]">Output</span>
                <span className="font-semibold text-[var(--foreground)]">{step.output}</span>
              </div>
            </div>
          </div>

          {/* Agent note */}
          <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--faint)]">
              <BookOpen size={13} aria-hidden />
              Agent note
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{step.note}</p>
          </div>

          {planStep?.acceptanceCriteria?.length ? (
            <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--faint)]">
                <CheckCircle2 size={13} aria-hidden />
                Delivery standards
              </div>
              <div className="mt-3 space-y-2">
                {planStep.acceptanceCriteria.map((criterion) => (
                  <div className="flex gap-2 text-sm leading-6 text-[var(--muted)]" key={criterion}>
                    <CheckCircle2 size={14} className="mt-1 shrink-0 text-[var(--success)]" aria-hidden />
                    <span>{criterion}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Artifacts section */}
          <div className="mt-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--faint)]">
              <FileText size={13} aria-hidden />
              Artifacts ({artifacts.length})
            </h3>
            <div className="mt-3 space-y-2">
              {artifacts.length ? (
                artifacts.map((artifact) => <ArtifactItem artifact={artifact} key={artifact.id} />)
              ) : (
                  <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] p-3 text-xs text-[var(--muted)]">
                  No artifacts produced yet.
                </div>
              )}
            </div>
          </div>

          {/* Event timeline */}
          <div className="mt-5">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--faint)]">
              <ScrollText size={13} aria-hidden />
              Trace ({stepEvents.length})
            </h3>
            <div className="mt-3 space-y-2">
              {stepEvents.length ? (
                stepEvents.map((event, index) => (
                  <div className="flex gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3" key={`${event.agent}-${event.step}-${index}`}>
                    <div className="mt-0.5 flex flex-col items-center gap-1">
                      <div className={`h-2 w-2 rounded-full ${
                        event.status === "blocked" || event.status === "error" ? "bg-[var(--danger)]" :
                        event.status === "completed" ? "bg-[var(--success)]" : "bg-[var(--accent)]"
                      }`} />
                      {index < stepEvents.length - 1 ? <span className="h-4 w-px bg-[var(--line)]" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-[var(--foreground)]">{event.agent}</span>
                        <StatusPill tone={event.status === "blocked" || event.status === "error" ? "danger" : event.status === "completed" ? "good" : "accent"}>
                          {event.status}
                        </StatusPill>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{event.summary}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface)] p-3 text-xs text-[var(--muted)]">
                  No trace events for this agent yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ Mission crew ═══ */}
        <div className="border-t border-[var(--line)] px-6 py-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--faint)]">
            <UsersRound size={13} aria-hidden />
            Mission crew
          </div>
          <div className="flex flex-wrap gap-2">
            {team.map((member) => {
              const busy = member.status === "working" || member.status === "waiting";
              const active = member.id === agent?.id;
              return (
                <button
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition hover:border-[var(--accent)] ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                      : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"
                  }`}
                  key={member.id}
                  onClick={() => onSelectAgent(member)}
                  type="button"
                >
                  {busy ? (
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                  ) : null}
                  {member.name}
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}

function getPreviousStep(label: string): string {
  const order = ["Intake", "Staffing", "Spec", "Backtest", "Risk", "Paper", "Approval"];
  const idx = order.indexOf(label);
  return idx > 0 ? order[idx - 1] : "Mission";
}

function ArtifactItem({ artifact }: { artifact: PlatformArtifact }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--foreground)]">{artifact.name}</div>
          <div className="mt-1 text-xs text-[var(--faint)]">{artifact.type}</div>
        </div>
        <StatusPill tone={artifact.status === "blocked" ? "danger" : artifact.status === "warning" ? "warn" : "good"}>
          {artifact.status}
        </StatusPill>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{artifact.summary}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase text-[var(--faint)]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">{value}</div>
    </div>
  );
}

function StatusDot({ status }: { status: PlatformRunStep["status"] }) {
  const color = {
    active: "bg-[var(--accent)]",
    done: "bg-[var(--success)]",
    warning: "bg-[var(--warning)]",
    waiting: "bg-[var(--faint)]",
    locked: "bg-[var(--faint)]"
  }[status];

  return <span className={`h-2.5 w-2.5 rounded-full ${color}`} />;
}

function getStatusIcon(status: PlatformRunStep["status"]) {
  return {
    done: <CheckCircle2 size={18} aria-hidden />,
    active: <PlayCircle size={18} aria-hidden />,
    waiting: <Circle size={18} aria-hidden />,
    warning: <TriangleAlert size={18} aria-hidden />,
    locked: <Lock size={18} aria-hidden />
  }[status];
}

function getArtifactsForStep(step: PlatformRunStep, artifacts: PlatformArtifact[]) {
  const expectedTypes = artifactTypesByStep[step.label] ?? [];
  return artifacts.filter((artifact) => expectedTypes.includes(artifact.type));
}

function agentInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function stepIdFromRunStep(step: PlatformRunStep) {
  return step.id.split("-step-").at(1) ?? step.id;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
