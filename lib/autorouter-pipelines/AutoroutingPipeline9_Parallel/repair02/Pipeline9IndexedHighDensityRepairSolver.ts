import type { HighDensityRepairSolver as NativeHighDensityRepairSolver } from "high-density-repair02"
// Pinned high-density-repair02 at 64bc8a1d5a1af753f1043092ffa9ec820ed14d4e.
// Copyright (c) tscircuit Inc. MIT license retained in ./LICENSE.
// Native repair order, geometry arithmetic, candidate budgets and stats retained.
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { cloneRoutes } from "high-density-repair02/lib/high-density-repair-solver/functions/cloneRoutes"
import { createBoundryViolationRects } from "high-density-repair02/lib/high-density-repair-solver/functions/createBoundryViolationRects"
import { createTraceViolationCircles } from "high-density-repair02/lib/high-density-repair-solver/functions/createTraceViolationCircles"
import { findClearanceConflicts } from "high-density-repair02/lib/high-density-repair-solver/functions/findClearanceConflicts"
import { findInteriorDiagonalSegmentsInBufferZone } from "high-density-repair02/lib/high-density-repair-solver/functions/findInteriorDiagonalSegmentsInBufferZone"
import { getBoundaryRect } from "high-density-repair02/lib/high-density-repair-solver/functions/getBoundaryRect"
import { getRoutePointLayer } from "high-density-repair02/lib/high-density-repair-solver/functions/getRoutePointLayer"
import { splitRouteIntoLayerSegments } from "high-density-repair02/lib/high-density-repair-solver/functions/splitRouteIntoLayerSegments"
import {
  BOTTOM_LAYER_COLOR,
  TRACE_CLEARANCE_REGRESSION_MAX,
} from "high-density-repair02/lib/high-density-repair-solver/shared/constants"
import type {
  HdRoute,
  HighDensityRepairSolverParams,
  VisualizationFrame,
  XY,
} from "high-density-repair02/lib/high-density-repair-solver/shared/types"
import { buildRepairFrames } from "./buildRepairFrames"

export type {
  DatasetSample,
  HdRoute,
  HighDensityRepairSolverParams,
} from "high-density-repair02/lib/high-density-repair-solver/shared/types"

export class Pipeline9IndexedHighDensityRepairSolver extends BaseSolver {
  override getSolverName(): string {
    return "HighDensityRepairSolver"
  }
  private frames: VisualizationFrame[] = []
  private readonly traceViolationCounts = new WeakMap<
    VisualizationFrame,
    number
  >()
  private clearanceRepairStats: Record<string, number> = {}
  private currentFrameIndex = 0
  private showBoundryViolationMarkers: boolean
  public repairedRoutes: HdRoute[] = []

  constructor(public readonly params: HighDensityRepairSolverParams = {}) {
    super()
    this.showBoundryViolationMarkers =
      params.showBoundryViolationMarkers ?? false
  }

  override _setup(): void {
    this.buildFrames()
    const boundryViolationCount = this.getCurrentBoundryViolationCount()
    const traceViolationCount = this.getCurrentTraceViolationCount()
    this.stats = {
      ...this.clearanceRepairStats,
      boundryViolationCount,
      traceViolationCount,
      margin: this.params.margin ?? 0.4,
      frames: this.frames.length,
      currentFrame: this.currentFrameIndex,
    }
  }

  override _step(): void {
    if (this.frames.length <= 1) {
      const boundryViolationCount = this.getCurrentBoundryViolationCount()
      const traceViolationCount = this.getCurrentTraceViolationCount()
      this.showBoundryViolationMarkers = true
      this.stats = {
        ...this.stats,
        boundryViolationCount,
        traceViolationCount,
      }
      this.solved = true
      return
    }

    if (this.currentFrameIndex < this.frames.length - 1) {
      this.currentFrameIndex += 1
    }

    const boundryViolationCount = this.getCurrentBoundryViolationCount()
    const traceViolationCount = this.getCurrentTraceViolationCount()
    this.stats = {
      ...this.clearanceRepairStats,
      boundryViolationCount,
      traceViolationCount,
      margin: this.params.margin ?? 0.4,
      frames: this.frames.length,
      currentFrame: this.currentFrameIndex,
      title: this.frames[this.currentFrameIndex]?.title,
    }

    if (this.currentFrameIndex >= this.frames.length - 1) {
      this.showBoundryViolationMarkers = true
      this.solved = true
    }
  }

  override getConstructorParams(): [HighDensityRepairSolverParams] {
    return [this.params]
  }

  override getOutput(): ReturnType<NativeHighDensityRepairSolver["getOutput"]> {
    const traceViolationCount = this.getCurrentTraceViolationCount()

    return {
      ...this.clearanceRepairStats,
      margin: this.params.margin ?? 0.4,
      repairedRoutes: this.repairedRoutes,
      frameCount: this.frames.length,
      traceViolationCount,
    }
  }

  setShowBoundryViolationMarkers(show: boolean): void {
    this.showBoundryViolationMarkers = show
  }

  private buildFrames(): void {
    const result = buildRepairFrames(
      this.params.sample,
      this.params.margin,
      this.params.captureProgressFrames ?? false,
      this.params.repairBoundaryDiagonals ?? true,
    )
    this.clearanceRepairStats = result.clearanceRepairStats ?? {}
    this.frames = result.frames
    this.repairedRoutes = result.repairedRoutes
  }

  private getCurrentFrame(): VisualizationFrame {
    const sample = this.params.sample
    return (
      this.frames[this.currentFrameIndex] ?? {
        title: "HighDensityRepair02",
        routes: cloneRoutes(sample?.nodeHdRoutes ?? []),
      }
    )
  }

  private getBoundryViolationsForFrame(frame: VisualizationFrame): ReturnType<typeof findInteriorDiagonalSegmentsInBufferZone> {
    const boundary = getBoundaryRect(this.params.sample?.nodeWithPortPoints)
    if (!boundary) return []
    return findInteriorDiagonalSegmentsInBufferZone(
      frame.routes,
      boundary,
      this.params.margin ?? 0.4,
    )
  }

  private getCurrentBoundryViolationCount(): number {
    return this.getBoundryViolationsForFrame(this.getCurrentFrame()).length
  }

  private getRouteNetNames(route: HdRoute | undefined): string[] {
    if (!route) return []
    const names = [route.connectionName, route.rootConnectionName].filter(
      (name): name is string => Boolean(name),
    )
    return Array.from(new Set(names))
  }

  private areRoutesSameNet(
    firstRoute: HdRoute | undefined,
    secondRoute: HdRoute | undefined,
  ): boolean {
    const firstNames = this.getRouteNetNames(firstRoute)
    const secondNames = this.getRouteNetNames(secondRoute)
    if (firstNames.length === 0 || secondNames.length === 0) return false
    return firstNames.some((name) => secondNames.includes(name))
  }

  private getCurrentTraceViolationCount(): number {
    const frame = this.getCurrentFrame()
    const cached = this.traceViolationCounts.get(frame)
    if (cached !== undefined) return cached
    const routes = frame.routes
    const movedRouteIndexes = new Set(routes.map((_, routeIndex) => routeIndex))
    const count = findClearanceConflicts(
      routes,
      movedRouteIndexes,
      TRACE_CLEARANCE_REGRESSION_MAX,
    ).filter(
      (conflict) =>
        !(conflict.layers[0] === "via" && conflict.layers[1] === "via") &&
        !this.areRoutesSameNet(
          routes[conflict.routeIndexes[0]],
          routes[conflict.routeIndexes[1]],
        ),
    ).length
    this.traceViolationCounts.set(frame, count)
    return count
  }

  override visualize(): GraphicsObject {
    const sample = this.params.sample
    const node = sample?.nodeWithPortPoints
    const obstacles = sample?.adjacentObstacles ?? []
    const frame = this.getCurrentFrame()
    const boundary = getBoundaryRect(node)

    const nodeRect =
      boundary && node?.capacityMeshNodeId
        ? [
            {
              center: boundary.center,
              width: boundary.width,
              height: boundary.height,
              stroke: "#1d4ed8",
              fill: "rgba(29, 78, 216, 0.08)",
              label: node.capacityMeshNodeId,
            },
          ]
        : boundary
          ? [
              {
                center: boundary.center,
                width: boundary.width,
                height: boundary.height,
                stroke: "#1d4ed8",
                fill: "rgba(29, 78, 216, 0.08)",
                label: "capacity-node",
              },
            ]
          : []

    const obstacleRects = obstacles
      .filter(
        (obstacle) => obstacle.center && obstacle.width && obstacle.height,
      )
      .map((obstacle, idx) => ({
        center: obstacle.center as XY,
        width: obstacle.width as number,
        height: obstacle.height as number,
        stroke: obstacle.type === "oval" ? "#a855f7" : "#dc2626",
        fill:
          obstacle.type === "oval"
            ? "rgba(168, 85, 247, 0.12)"
            : "rgba(220, 38, 38, 0.08)",
        label: obstacle.type
          ? `obstacle:${obstacle.type}:${idx}`
          : `obstacle:${idx}`,
      }))

    const boundryViolationRects =
      this.showBoundryViolationMarkers && boundary
        ? createBoundryViolationRects(this.getBoundryViolationsForFrame(frame))
        : []
    const traceViolationCircles = this.showBoundryViolationMarkers
      ? createTraceViolationCircles(
          frame.routes,
          TRACE_CLEARANCE_REGRESSION_MAX,
        )
      : []

    const points = [
      ...(node?.portPoints ?? []).map((portPoint) => ({
        x: portPoint.x,
        y: portPoint.y,
        color: "#0f766e",
        label:
          portPoint.connectionName ?? portPoint.portPointId ?? "port-point",
      })),
      ...frame.routes
        .flatMap((route) => route.route ?? [])
        .map((routePoint) => ({
          x: routePoint.x,
          y: routePoint.y,
          color:
            getRoutePointLayer(routePoint) === "bottom"
              ? BOTTOM_LAYER_COLOR
              : "#0ea5e9",
          label: "",
        })),
      ...(frame.overlayPoints ?? []),
    ]

    const lines = [
      ...(frame.originalRoutes ?? []).flatMap((route) =>
        splitRouteIntoLayerSegments(route).map((line) => ({
          ...line,
          strokeColor: "#111111",
          strokeWidth: Math.max(line.strokeWidth * 0.6, 0.05),
          label: `original:${line.label}`,
        })),
      ),
      ...frame.routes
        .filter((route) => (route.route?.length ?? 0) >= 2)
        .flatMap((route) => splitRouteIntoLayerSegments(route)),
      ...(frame.overlayLines ?? []),
    ]

    const circles = frame.routes.flatMap((route) =>
      (route.vias ?? []).map((via) => ({
        center: { x: via.x, y: via.y },
        radius: (via.diameter ?? route.viaDiameter ?? 0.3) / 2,
        stroke: "#7c3aed",
        fill: "rgba(124, 58, 237, 0.2)",
        label: route.connectionName ? `via:${route.connectionName}` : "via",
      })),
    )
    circles.push(...traceViolationCircles)

    return {
      coordinateSystem: "cartesian",
      title: frame.title,
      rects: [
        ...nodeRect,
        ...obstacleRects,
        ...(frame.overlayRects ?? []),
        ...boundryViolationRects,
      ],
      points,
      lines,
      circles,
      arrows: frame.overlayArrows,
    }
  }
}
