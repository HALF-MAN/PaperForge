"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Circle, PlayCircle, TriangleAlert } from "lucide-react";
import type { Plan, PlatformAgent, PlatformArtifact, PlatformRunStep } from "@/src/platform/types";

const nodeWidth = 260;
const nodeHeight = 212;

type Point = { x: number; y: number };

type WorkflowGraphProps = {
  agents: PlatformAgent[];
  artifacts: PlatformArtifact[];
  onSelectStep: (step: PlatformRunStep) => void;
  plan?: Plan;
  selectedStepId: string;
  steps: PlatformRunStep[];
};

type DragState = {
  moved: boolean;
  origin: Point;
  pointerId: number;
  start: Point;
  stepId: string;
};

type PanState = {
  pointerId: number;
  scroll: Point;
  start: Point;
};

export function WorkflowGraph({ agents, artifacts, onSelectStep, plan, selectedStepId, steps }: WorkflowGraphProps) {
  const orderedSteps = useMemo(() => orderSteps(steps, plan), [plan, steps]);
  const initialPositions = useMemo(() => layoutSteps(orderedSteps), [orderedSteps]);
  const [positions, setPositions] = useState<Map<string, Point>>(initialPositions);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const layoutKey = useMemo(() => orderedSteps.map((step) => step.id).join("|"), [orderedSteps]);
  const layoutKeyRef = useRef(layoutKey);

  useEffect(() => {
    if (layoutKeyRef.current === layoutKey) return;
    layoutKeyRef.current = layoutKey;
    const timeout = window.setTimeout(() => {
      setPositions((current) => {
        const next = new Map(initialPositions);
        for (const [id, position] of current) {
          if (next.has(id)) next.set(id, position);
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialPositions, layoutKey]);

  const edges = useMemo(() => buildEdges(orderedSteps, plan), [orderedSteps, plan]);
  const canvasSize = useMemo(() => getCanvasSize(positions, orderedSteps), [orderedSteps, positions]);

  function handlePointerDown(step: PlatformRunStep, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const origin = positions.get(step.id) ?? initialPositions.get(step.id) ?? { x: 32, y: 32 };
    dragRef.current = {
      moved: false,
      origin,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      stepId: step.id
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;

    setPositions((current) => {
      const next = new Map(current);
      next.set(drag.stepId, {
        x: Math.max(16, drag.origin.x + dx),
        y: Math.max(16, drag.origin.y + dy)
      });
      return next;
    });
  }

  function handlePointerUp(step: PlatformRunStep, event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag.moved) {
      suppressClickRef.current = step.id;
      return;
    }
    onSelectStep(step);
  }

  function handleClick(step: PlatformRunStep) {
    if (suppressClickRef.current === step.id) {
      suppressClickRef.current = null;
      return;
    }
    onSelectStep(step);
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-workflow-node]")) return;

    panRef.current = {
      pointerId: event.pointerId,
      scroll: {
        x: event.currentTarget.scrollLeft,
        y: event.currentTarget.scrollTop
      },
      start: { x: event.clientX, y: event.clientY }
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = pan.scroll.x - (event.clientX - pan.start.x);
    event.currentTarget.scrollTop = pan.scroll.y - (event.clientY - pan.start.y);
  }

  function handleCanvasPointerUp(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function resetView() {
    viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  }

  return (
    <div
      className="relative h-full min-h-[680px] w-full min-w-0 cursor-grab overflow-auto bg-[var(--canvas)] active:cursor-grabbing"
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      ref={viewportRef}
    >
      <button
        className="sticky left-4 top-4 z-30 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs font-semibold text-[var(--muted)] shadow-[var(--shadow-soft)] transition hover:border-[var(--line-strong)] hover:text-[var(--foreground)]"
        onClick={resetView}
        type="button"
      >
        Reset view
      </button>
      <div
        className="relative -mt-8"
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
          backgroundImage: "radial-gradient(circle, var(--grid-line) 1px, transparent 1px)",
          backgroundSize: "40px 40px"
        }}
      >
        <WorkflowLinkLayer edges={edges} positions={positions} />
        {orderedSteps.map((step) => {
          const agent = agents.find((item) => item.id === step.agentId);
          const planStep = plan?.steps.find((item) => item.id === stepIdFromRunStep(step));
          const artifactCount = artifacts.filter((artifact) => artifact.missionId === step.missionId && artifactMatchesStep(artifact, step)).length;
          const position = positions.get(step.id) ?? initialPositions.get(step.id) ?? { x: 32, y: 32 };

          return (
            <button
              aria-label={`Open ${step.label}`}
              className={`absolute z-10 w-[260px] cursor-grab rounded-lg border bg-[var(--panel)] p-3 text-left shadow-[var(--shadow-soft)] hover:shadow-lg transition-[border-color,box-shadow] active:cursor-grabbing ${
                selectedStepId === step.id ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/25" : "border-[var(--line)] hover:border-[var(--line-strong)]"
              }`}
              data-workflow-node={step.id}
              key={step.id}
              onClick={() => handleClick(step)}
              onPointerDown={(event) => handlePointerDown(step, event)}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => handlePointerUp(step, event)}
              style={{ left: position.x, top: position.y, height: nodeHeight }}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="truncate text-sm font-semibold text-[var(--foreground)]">{step.label}</div>
                {statusIcon(step.status)}
              </div>
              <div className="mt-1 truncate text-xs text-[var(--muted)]">{agent?.name ?? step.agentId}</div>
              <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--muted)]">
                <span className="font-mono">{step.tool}</span> {"->"} {step.output}
              </div>
              <div className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--muted)]">{step.note}</div>
              <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-2 text-[11px] font-semibold text-[var(--faint)]">
                <span>{step.status}</span>
                <span>
                  {artifactCount} artifact{artifactCount === 1 ? "" : "s"}
                  {planStep?.acceptanceCriteria?.length ? ` · ${planStep.acceptanceCriteria.length} standards` : ""}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowLinkLayer({ edges, positions }: { edges: Array<{ id: string; source: string; target: string; active: boolean }>; positions: Map<string, Point> }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible">
      {edges.map((edge) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) return null;
        const points = linkPoints(nodeBox(source), nodeBox(target));
        return (
          <path
            className={edge.active ? "animate-pulse" : undefined}
            d={smoothPath(points.source, points.target)}
            fill="none"
            key={edge.id}
            stroke="var(--accent)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={edge.active ? 0.95 : 0.72}
            strokeWidth={2}
          />
        );
      })}
    </svg>
  );
}

function buildEdges(orderedSteps: PlatformRunStep[], plan?: Plan) {
  const stepByPlanId = new Map(orderedSteps.map((step) => [stepIdFromRunStep(step), step]));
  const edges: Array<{ id: string; source: string; target: string; active: boolean }> = [];

  if (plan?.steps.length) {
    for (const planStep of plan.steps) {
      const target = stepByPlanId.get(planStep.id);
      if (!target) continue;
      for (const dependencyId of planStep.dependsOn) {
        const source = stepByPlanId.get(dependencyId);
        if (!source) continue;
        edges.push({
          id: `${source.id}-${target.id}`,
          source: source.id,
          target: target.id,
          active: target.status === "active"
        });
      }
    }
  }

  return edges.length
    ? edges
    : orderedSteps.slice(1).map((step, index) => ({
        id: `${orderedSteps[index].id}-${step.id}`,
        source: orderedSteps[index].id,
        target: step.id,
        active: step.status === "active"
      }));
}

function layoutSteps(orderedSteps: PlatformRunStep[]) {
  const maxColumns = Math.min(4, Math.max(1, Math.ceil(orderedSteps.length / 2)));
  const xGap = 340;
  const yGap = 300;
  const positions = new Map<string, Point>();

  orderedSteps.forEach((step, index) => {
    const row = Math.floor(index / maxColumns);
    const rawColumn = index % maxColumns;
    const column = row % 2 === 0 ? rawColumn : maxColumns - 1 - rawColumn;
    positions.set(step.id, {
      x: 32 + column * xGap,
      y: 32 + row * yGap
    });
  });

  return positions;
}

function getCanvasSize(positions: Map<string, Point>, steps: PlatformRunStep[]) {
  let width = 900;
  let height = 680;

  for (const step of steps) {
    const position = positions.get(step.id);
    if (!position) continue;
    width = Math.max(width, position.x + nodeWidth + 80);
    height = Math.max(height, position.y + nodeHeight + 80);
  }

  return { width, height };
}

function orderSteps(steps: PlatformRunStep[], plan?: Plan) {
  if (!plan?.steps.length) {
    return [...steps].sort((a, b) => stepRank(a.label) - stepRank(b.label));
  }

  const order = new Map(plan.steps.map((step, index) => [step.id, index]));
  return [...steps].sort((a, b) => (order.get(stepIdFromRunStep(a)) ?? 999) - (order.get(stepIdFromRunStep(b)) ?? 999));
}

function nodeBox(position: Point) {
  return {
    x: position.x,
    y: position.y,
    width: nodeWidth,
    height: nodeHeight
  };
}

function linkPoints(
  source: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number }
) {
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? {
          source: { x: source.x + source.width, y: sourceCenter.y },
          target: { x: target.x, y: targetCenter.y }
        }
      : {
          source: { x: source.x, y: sourceCenter.y },
          target: { x: target.x + target.width, y: targetCenter.y }
        };
  }

  return dy >= 0
    ? {
        source: { x: sourceCenter.x, y: source.y + source.height },
        target: { x: targetCenter.x, y: target.y }
      }
    : {
        source: { x: sourceCenter.x, y: source.y },
        target: { x: targetCenter.x, y: target.y + target.height }
      };
}

function smoothPath(source: { x: number; y: number }, target: { x: number; y: number }) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const offset = Math.max(48, Math.abs(dx) * 0.45);
    const direction = dx >= 0 ? 1 : -1;
    return `M ${source.x} ${source.y} C ${source.x + offset * direction} ${source.y}, ${target.x - offset * direction} ${target.y}, ${target.x} ${target.y}`;
  }

  const offset = Math.max(48, Math.abs(dy) * 0.45);
  const direction = dy >= 0 ? 1 : -1;
  return `M ${source.x} ${source.y} C ${source.x} ${source.y + offset * direction}, ${target.x} ${target.y - offset * direction}, ${target.x} ${target.y}`;
}

function stepIdFromRunStep(step: PlatformRunStep) {
  return step.id.split("-step-").at(1) ?? step.id;
}

function statusIcon(status: PlatformRunStep["status"]) {
  if (status === "active") return <PlayCircle size={15} className="text-[var(--accent)]" aria-hidden />;
  if (status === "warning") return <TriangleAlert size={15} className="text-[var(--warning)]" aria-hidden />;
  return <Circle size={15} className="text-[var(--faint)]" aria-hidden />;
}

function artifactMatchesStep(artifact: PlatformArtifact, step: PlatformRunStep) {
  const output = step.output.toLowerCase();
  return artifact.name.toLowerCase() === output || artifact.type.replaceAll("_", "").toLowerCase() === output.toLowerCase();
}

function stepRank(label: string) {
  const order = [
    "Intake",
    "Staffing",
    "Strategy Research",
    "Spec",
    "Backtest",
    "Risk Assessment",
    "Risk",
    "Strategy Review",
    "Paper Trading",
    "Paper",
    "Human Approval",
    "Approval"
  ];
  const index = order.indexOf(label);
  return index === -1 ? order.length : index;
}
