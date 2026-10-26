import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { BaseSolver } from "../../BaseSolver"
import { PortfolioSingleIntraNodeSolver } from "../PortfolioSingleIntraNodeSolver"
import {
  createInvalidDirectConnectionRoutes,
  createInvalidSameLayerCrossingRoutes,
  hasImpossibleSameLayerCrossingGeometry,
} from "./invalidSameLayerCrossingGeometry"

type PortfolioSingleIntraNodeSolverParams = ConstructorParameters<
  typeof PortfolioSingleIntraNodeSolver
>[0]

export const DEFAULT_MAX_GROWTH_ATTEMPTS = 3

export type GrowShrinkHighDensityIntraNodeSolverParams =
  PortfolioSingleIntraNodeSolverParams & {
    maxGrowthAttempts?: number
    maxInnerIterationsPerGrowthAttempt?: number
    fallbackToInvalidGeometryOnFailure?: boolean
    growShrinkSolutionValidator?: (
      routes: HighDensityIntraNodeRoute[],
    ) => boolean
  }

type ScaleCandidate = {
  growthAttempt: number
  scaleFactor: number
  solver: PortfolioSingleIntraNodeSolver
  failedRecorded: boolean
}

type ScaleSearch = {
  candidates: ScaleCandidate[]
  nextAttempt: number | null
  cursor: number
  incumbent?: ScaleCandidate
}

const scalePoint = <T extends { x: number; y: number }>(
  point: T,
  center: { x: number; y: number },
  scaleFactor: number,
): T => ({
  ...point,
  x: center.x + (point.x - center.x) * scaleFactor,
  y: center.y + (point.y - center.y) * scaleFactor,
})

const scalePortPoint = (
  portPoint: PortPoint,
  center: { x: number; y: number },
  scaleFactor: number,
): PortPoint => scalePoint(portPoint, center, scaleFactor)

const scaleNodeWithPortPoints = (
  node: NodeWithPortPoints,
  scaleFactor: number,
): NodeWithPortPoints => ({
  ...node,
  width: node.width * scaleFactor,
  height: node.height * scaleFactor,
  portPoints: node.portPoints.map((portPoint) =>
    scalePortPoint(portPoint, node.center, scaleFactor),
  ),
  portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
    scalePortPoint(start, node.center, scaleFactor),
    scalePortPoint(end, node.center, scaleFactor),
  ]),
})

const scaleRoute = (
  route: HighDensityIntraNodeRoute,
  center: { x: number; y: number },
  scaleFactor: number,
): HighDensityIntraNodeRoute => ({
  ...route,
  route: route.route.map((point) => scalePoint(point, center, scaleFactor)),
  vias: route.vias.map((via) => scalePoint(via, center, scaleFactor)),
  jumpers: route.jumpers?.map((jumper) => ({
    ...jumper,
    start: scalePoint(jumper.start, center, scaleFactor),
    end: scalePoint(jumper.end, center, scaleFactor),
  })),
})

const routeColors = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#9333ea",
  "#0891b2",
]

const connectionLabel = (
  connectionName: string,
  rootConnectionName?: string,
  extraLines: string[] = [],
) =>
  [
    connectionName,
    rootConnectionName
      ? `rootConnectionName: ${rootConnectionName}`
      : undefined,
    ...extraLines,
  ]
    .filter(Boolean)
    .join("\n")

export class GrowShrinkHighDensityIntraNodeSolver extends BaseSolver {
  override getSolverName(): string {
    return "GrowShrinkHighDensityIntraNodeSolver"
  }

  constructorParams: GrowShrinkHighDensityIntraNodeSolverParams
  nodeWithPortPoints: NodeWithPortPoints
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  failedSolvers: PortfolioSingleIntraNodeSolver[] = []
  activeSubSolver: PortfolioSingleIntraNodeSolver | null = null
  winningSolver?: PortfolioSingleIntraNodeSolver
  scaleFactor = 1
  growthAttempts = 0
  maxGrowthAttempts: number
  minimumGrowthAttempts: number
  private readonly raceGrowthAttempts: boolean
  private scaleSearch?: ScaleSearch

  constructor(params: GrowShrinkHighDensityIntraNodeSolverParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    // Sub-via-sized nodes spend their first growth attempts just reaching a
    // usable routing scale. Preserve the normal search budget after that scale
    // is reached instead of exhausting it before the portfolio can place vias.
    const minNodeDimension = Math.min(
      this.nodeWithPortPoints.width,
      this.nodeWithPortPoints.height,
    )
    const growthAttemptsToFitVia =
      minNodeDimension > 0
        ? Math.max(
            0,
            Math.ceil(
              Math.log2((params.viaDiameter ?? 0.3) / minNodeDimension),
            ),
          )
        : 0
    let minimumPortGap = Number.POSITIVE_INFINITY
    const ports = this.nodeWithPortPoints.portPoints
    for (let i = 0; i < ports.length; i++) {
      for (let j = i + 1; j < ports.length; j++) {
        const a = ports[i]!
        const b = ports[j]!
        if (
          a.z !== b.z ||
          (a.rootConnectionName ?? a.connectionName) ===
            (b.rootConnectionName ?? b.connectionName)
        ) {
          continue
        }
        const gap = Math.hypot(a.x - b.x, a.y - b.y)
        if (gap > 1e-9) minimumPortGap = Math.min(minimumPortGap, gap)
      }
    }
    // Crowded terminals can consume the initial scales just as sub-via nodes
    // do. Keep the normal search budget after unrelated copper can first fit.
    const growthAttemptsToFitPorts = Math.max(
      0,
      Math.ceil(Math.log2((params.traceWidth ?? 0.15) / minimumPortGap)),
    )
    const growthAttemptsToFitGeometry = Math.max(
      growthAttemptsToFitVia,
      growthAttemptsToFitPorts,
    )
    this.maxGrowthAttempts =
      params.maxGrowthAttempts ??
      DEFAULT_MAX_GROWTH_ATTEMPTS + growthAttemptsToFitGeometry
    // Preserve the existing attempt order; only extend the upper search bound.
    this.minimumGrowthAttempts = Math.min(
      params.maxGrowthAttempts ??
        DEFAULT_MAX_GROWTH_ATTEMPTS + growthAttemptsToFitVia,
      Math.max(growthAttemptsToFitVia, 0, growthAttemptsToFitPorts - 1),
    )
    this.MAX_ITERATIONS =
      20_000_000 * (params.effort ?? 1) * (this.maxGrowthAttempts + 1)
    this.raceGrowthAttempts = this.shouldRaceGrowthAttempts()

    if (hasImpossibleSameLayerCrossingGeometry(this.nodeWithPortPoints)) {
      if (!params.fallbackToInvalidGeometryOnFailure) {
        this.failed = true
        this.progress = 1
        this.error =
          "GrowShrinkHighDensityIntraNodeSolver cannot route an impossible single-layer crossing"
        return
      }
      this.solvedRoutes = createInvalidSameLayerCrossingRoutes(
        this.nodeWithPortPoints,
        params.traceWidth ?? 0.15,
        params.viaDiameter ?? 0.3,
      )
      this.solved = true
      this.progress = 1
      this.stats = {
        invalidGeometryFallback: true,
        reason: "single-layer node has same-layer crossings",
      }
    }
  }

  getConstructorParams() {
    return this.constructorParams
  }

  private shouldRaceGrowthAttempts(): boolean {
    const params = this.constructorParams
    const node = this.nodeWithPortPoints
    const ports = node.portPoints
    if (
      !params.rejectOverlappingTerminals ||
      params.fallbackToInvalidGeometryOnFailure ||
      new Set(node.availableZ ?? ports.map((point) => point.z ?? 0)).size < 3
    ) {
      return false
    }
    const segmentCount =
      node.portPointsInPairs?.length ??
      new Set(ports.map((point) => point.connectionName)).size
    if (segmentCount < 8) return false

    const traceWidth = params.traceWidth ?? 0.15
    let clearanceDeficit = false
    for (let i = 0; i < ports.length; i++) {
      for (let j = i + 1; j < ports.length; j++) {
        const a = ports[i]!
        const b = ports[j]!
        if (
          a.z !== b.z ||
          (a.rootConnectionName ?? a.connectionName) ===
            (b.rootConnectionName ?? b.connectionName) ||
          params.connMap?.areIdsConnected(a.connectionName, b.connectionName)
        ) {
          continue
        }
        const gap = Math.hypot(a.x - b.x, a.y - b.y)
        // Copper overlap is already rejected cheaply by the existing preflight.
        if (gap < traceWidth - 1e-6) return false
        if (gap < traceWidth + 0.1 - 1e-6) clearanceDeficit = true
      }
    }
    return clearanceDeficit
  }

  private createScaleCandidate(growthAttempt: number): ScaleCandidate {
    this.growthAttempts = growthAttempt
    this.scaleFactor = 2 ** growthAttempt
    this.createActiveSubSolver()
    this.stats.scaleSearchCandidateCount =
      (this.stats.scaleSearchCandidateCount ?? 0) + 1
    return {
      growthAttempt,
      scaleFactor: this.scaleFactor,
      solver: this.activeSubSolver!,
      failedRecorded: false,
    }
  }

  private addScaleSearchWave(search: ScaleSearch): void {
    for (
      let i = 0;
      i < DEFAULT_MAX_GROWTH_ATTEMPTS && search.nextAttempt !== null;
      i++
    ) {
      const attempt = search.nextAttempt
      search.candidates.push(this.createScaleCandidate(attempt))
      search.nextAttempt =
        attempt >= this.maxGrowthAttempts
          ? null
          : Math.max(attempt + 1, this.minimumGrowthAttempts)
    }
    search.cursor = 0
  }

  private initializeScaleSearch(): ScaleSearch {
    const search: ScaleSearch = {
      candidates: [],
      nextAttempt: 0,
      cursor: 0,
    }
    this.addScaleSearchWave(search)
    this.activeSubSolver = null
    return search
  }

  private recordScaleFailure(candidate: ScaleCandidate): void {
    if (!candidate.solver.failed || candidate.failedRecorded) return
    candidate.failedRecorded = true
    this.failedSolvers.push(candidate.solver)
    this.error = candidate.solver.error
    this.activeSubSolver = null
  }

  private acceptScaleCandidate(candidate: ScaleCandidate): boolean {
    this.scaleFactor = candidate.scaleFactor
    this.growthAttempts = candidate.growthAttempt
    this.activeSubSolver = candidate.solver
    if (!this.acceptSolution(candidate.solver)) {
      this.recordScaleFailure(candidate)
      return false
    }
    this.activeSubSolver = null
    this.scaleSearch = undefined
    return true
  }

  private stepScaleRefinement(search: ScaleSearch): boolean {
    const incumbent = search.incumbent!
    for (const candidate of search.candidates) {
      if (
        candidate.scaleFactor >= incumbent.scaleFactor ||
        candidate.solver.failed
      ) {
        continue
      }
      const supervised = candidate.solver.supervisedSolvers?.find(
        ({ solver }) => solver instanceof HighDensitySolverA03,
      )
      if (!supervised || supervised.solver.failed) continue
      this.scaleFactor = candidate.scaleFactor
      this.growthAttempts = candidate.growthAttempt
      this.activeSubSolver = candidate.solver
      const before = supervised.solver.iterations
      if (supervised.solver.solved) {
        // Observe the child's terminal state through the ordinary onSolve path.
        candidate.solver.step()
      } else {
        candidate.solver.stepCandidate(supervised)
      }
      this.stats.scaleRefinementNativeIterations =
        (this.stats.scaleRefinementNativeIterations ?? 0) +
        supervised.solver.iterations - before
      if (candidate.solver.solved && this.acceptScaleCandidate(candidate)) {
        return true
      }
      this.recordScaleFailure(candidate)
      return true
    }
    search.incumbent = undefined
    return this.acceptScaleCandidate(incumbent)
  }

  private stepScaleSearch(): void {
    // Interleave the existing proposals; refine a successful family at smaller
    // scales before accepting more geometric relaxation.
    const search = (this.scaleSearch ??= this.initializeScaleSearch())
    if (search.incumbent && this.stepScaleRefinement(search)) return

    if (!search.candidates.some(({ solver }) => !solver.failed)) {
      if (search.nextAttempt === null) {
        this.failed = true
        this.activeSubSolver = null
        this.scaleSearch = undefined
        this.error = `GrowShrinkHighDensityIntraNodeSolver exhausted all scale portfolios. Last error: ${this.error}`
        return
      }
      this.addScaleSearchWave(search)
    }
    let candidate = search.candidates[search.cursor++ % search.candidates.length]!
    while (candidate.solver.failed) {
      candidate = search.candidates[search.cursor++ % search.candidates.length]!
    }
    this.scaleFactor = candidate.scaleFactor
    this.growthAttempts = candidate.growthAttempt
    this.activeSubSolver = candidate.solver
    candidate.solver.step()
    if (candidate.solver.solved) {
      if (
        candidate.solver.winningSolver instanceof HighDensitySolverA03 &&
        search.candidates.some(
          (other) =>
            other.scaleFactor < candidate.scaleFactor && !other.solver.failed,
        )
      ) {
        search.incumbent = candidate
        this.stats.scaleSearchIncumbentFactor = candidate.scaleFactor
        return
      }
      if (this.acceptScaleCandidate(candidate)) return
    }
    this.recordScaleFailure(candidate)
  }

  private createActiveSubSolver() {
    const { growShrinkSolutionValidator: _, ...portfolioParams } =
      this.constructorParams
    this.activeSubSolver = new PortfolioSingleIntraNodeSolver({
      ...portfolioParams,
      priorityCoordinateScale:
        (portfolioParams.priorityCoordinateScale ?? 1) * this.scaleFactor,
      enableNegotiatedSearch:
        this.scaleFactor === 1 &&
        (portfolioParams.enableNegotiatedSearch ?? true),
      nodeWithPortPoints: scaleNodeWithPortPoints(
        this.nodeWithPortPoints,
        this.scaleFactor,
      ),
    })
    if (this.constructorParams.maxInnerIterationsPerGrowthAttempt) {
      this.activeSubSolver.MAX_ITERATIONS =
        this.constructorParams.maxInnerIterationsPerGrowthAttempt
    }
  }

  private acceptSolution(solver: PortfolioSingleIntraNodeSolver): boolean {
    const solvedRoutes =
      this.scaleFactor === 1
        ? solver.solvedRoutes
        : solver.solvedRoutes.map((route) =>
            scaleRoute(
              route,
              this.nodeWithPortPoints.center,
              1 / this.scaleFactor,
            ),
          )
    if (
      this.constructorParams.growShrinkSolutionValidator &&
      !this.constructorParams.growShrinkSolutionValidator(solvedRoutes)
    ) {
      solver.solved = false
      solver.failed = true
      solver.error = "High-density scale solution rejected by validator"
      return false
    }
    this.winningSolver = solver
    this.error = null
    this.solvedRoutes = solvedRoutes
    this.solved = true
    this.failed = false
    return true
  }

  computeProgress() {
    const progress = Math.min(
      0.99,
      (this.growthAttempts + (this.activeSubSolver?.progress ?? 0)) /
        (this.maxGrowthAttempts + 1),
    )
    return this.raceGrowthAttempts ? Math.max(this.progress, progress) : progress
  }

  override tryFinalAcceptance(): void {
    if (this.iterations <= this.MAX_ITERATIONS || !this.scaleSearch) return
    const incumbent = this.scaleSearch.incumbent
    try {
      if (incumbent?.solver.solved) this.acceptScaleCandidate(incumbent)
    } finally {
      this.scaleSearch = undefined
    }
  }

  _step() {
    if (this.raceGrowthAttempts) {
      try {
        this.stepScaleSearch()
      } catch (error) {
        this.scaleSearch = undefined
        throw error
      }
      return
    }
    if (!this.activeSubSolver) {
      this.createActiveSubSolver()
    }

    this.activeSubSolver!.step()

    if (this.activeSubSolver!.solved) {
      if (this.acceptSolution(this.activeSubSolver!)) {
        this.activeSubSolver = null
        return
      }
    }

    if (!this.activeSubSolver!.failed) {
      return
    }

    this.failedSolvers.push(this.activeSubSolver!)
    this.error = this.activeSubSolver!.error
    this.activeSubSolver = null

    if (this.growthAttempts >= this.maxGrowthAttempts) {
      if (this.constructorParams.fallbackToInvalidGeometryOnFailure) {
        this.solvedRoutes = createInvalidDirectConnectionRoutes(
          this.nodeWithPortPoints,
          this.constructorParams.traceWidth ?? 0.15,
          this.constructorParams.viaDiameter ?? 0.3,
        )
        this.solved = true
        this.failed = false
        this.progress = 1
        this.stats = {
          ...this.stats,
          invalidGeometryFallback: true,
          reason: "growth attempts exhausted",
          lastError: this.error,
        }
        this.error = null
        return
      }

      this.failed = true
      this.error = `GrowShrinkHighDensityIntraNodeSolver failed after resizing to ${this.scaleFactor}x. Last error: ${this.error}`
      return
    }

    this.growthAttempts = Math.max(
      this.growthAttempts + 1,
      this.minimumGrowthAttempts,
    )
    this.scaleFactor = 2 ** this.growthAttempts
  }

  visualize(): GraphicsObject {
    const delegatedVisualization =
      this.activeSubSolver?.visualize() ?? this.winningSolver?.visualize()
    if (delegatedVisualization) return delegatedVisualization

    if (this.solvedRoutes.length > 0) {
      return {
        title: this.stats.invalidGeometryFallback
          ? "Invalid same-layer crossing geometry"
          : "Grow/shrink high density routes",
        lines: this.solvedRoutes.flatMap((route, routeIndex) =>
          route.route.slice(0, -1).map((point, pointIndex) => {
            const nextPoint = route.route[pointIndex + 1]
            return {
              points: [point, nextPoint],
              strokeColor: routeColors[routeIndex % routeColors.length],
              strokeWidth: route.traceThickness,
              layer: `z${point.z}`,
              label: connectionLabel(
                route.connectionName,
                route.rootConnectionName,
                [
                  `z${point.z}`,
                  this.stats.invalidGeometryFallback
                    ? "invalid fallback route"
                    : undefined,
                ].filter(Boolean) as string[],
              ),
            }
          }),
        ),
        points: this.nodeWithPortPoints.portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          color:
            routeColors[
              Math.max(
                0,
                this.solvedRoutes.findIndex(
                  (route) => route.connectionName === point.connectionName,
                ),
              ) % routeColors.length
            ],
          label: connectionLabel(
            point.connectionName,
            point.rootConnectionName,
            [`z${point.z}`],
          ),
        })),
        rects: [
          {
            center: this.nodeWithPortPoints.center,
            width: this.nodeWithPortPoints.width,
            height: this.nodeWithPortPoints.height,
            fill: this.stats.invalidGeometryFallback
              ? "rgba(245, 158, 11, 0.12)"
              : "rgba(14, 165, 233, 0.08)",
            stroke: this.stats.invalidGeometryFallback
              ? "rgba(217, 119, 6, 0.8)"
              : "rgba(14, 165, 233, 0.55)",
            label: [
              this.nodeWithPortPoints.capacityMeshNodeId,
              this.stats.reason,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        circles: [],
      }
    }

    return (
      delegatedVisualization ?? {
        lines: [],
        points: [],
        rects: [],
        circles: [],
      }
    )
  }
}
