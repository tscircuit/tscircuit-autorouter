import type { GraphicsObject } from "graphics-debug"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { BaseSolver } from "../../BaseSolver"
import { CachedIntraNodeRouteSolver } from "../../HighDensitySolver/CachedIntraNodeRouteSolver"
import { HyperParameterSupervisorSolver } from "../../HyperParameterSupervisorSolver"
import { PortfolioSingleIntraNodeSolver } from "../PortfolioSingleIntraNodeSolver"
import {
  createInvalidDirectConnectionRoutes,
  createInvalidSameLayerCrossingRoutes,
  hasImpossibleSameLayerCrossingGeometry,
} from "./invalidSameLayerCrossingGeometry"

type PortfolioSingleIntraNodeSolverParams = ConstructorParameters<
  typeof PortfolioSingleIntraNodeSolver
>[0]

type GrowthAttemptFrame = {
  solver: PortfolioSingleIntraNodeSolver
  growthAttempts: number
  scaleFactor: number
  spaciousNode: boolean
  initialCachedProbes:
    | [CachedIntraNodeRouteSolver, CachedIntraNodeRouteSolver]
    | null
  initialCachedProbeCount: number | null
}

export const DEFAULT_MAX_GROWTH_ATTEMPTS = 3

export type GrowShrinkHighDensityIntraNodeSolverParams =
  PortfolioSingleIntraNodeSolverParams & {
    maxGrowthAttempts?: number
    maxInnerIterationsPerGrowthAttempt?: number
    prioritizeGrowthAfterInitialProbes?: boolean
    fallbackToInvalidGeometryOnFailure?: boolean
    growShrinkSolutionValidator?: (
      routes: HighDensityIntraNodeRoute[],
    ) => boolean
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
  private activeAttemptFrame: GrowthAttemptFrame | null = null
  private suspendedInitialAttempt: GrowthAttemptFrame | null = null
  private deferredSolvedAttempt: GrowthAttemptFrame | null = null
  private earlyGrowthAttemptTried = false

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
    // Preserve the existing attempt bounds after geometry first becomes usable.
    this.minimumGrowthAttempts = Math.min(
      params.maxGrowthAttempts ??
        DEFAULT_MAX_GROWTH_ATTEMPTS + growthAttemptsToFitVia,
      Math.max(growthAttemptsToFitVia, 0, growthAttemptsToFitPorts - 1),
    )
    this.MAX_ITERATIONS =
      20_000_000 * (params.effort ?? 1) * (this.maxGrowthAttempts + 1)

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

  private createActiveSubSolver() {
    const {
      growShrinkSolutionValidator: _,
      prioritizeGrowthAfterInitialProbes: _prioritizeGrowthAfterInitialProbes,
      ...portfolioParams
    } = this.constructorParams
    this.activeSubSolver = new PortfolioSingleIntraNodeSolver({
      ...portfolioParams,
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
    this.activeAttemptFrame = {
      solver: this.activeSubSolver,
      growthAttempts: this.growthAttempts,
      scaleFactor: this.scaleFactor,
      spaciousNode: false,
      initialCachedProbes: null,
      initialCachedProbeCount: null,
    }
  }

  private shouldTryNextScaleEarly(): boolean {
    const frame = this.activeAttemptFrame
    const solver = this.activeSubSolver
    if (
      this.constructorParams.prioritizeGrowthAfterInitialProbes !== true ||
      !this.constructorParams.connMap ||
      this.earlyGrowthAttemptTried ||
      !frame ||
      frame.spaciousNode ||
      !solver ||
      frame.solver !== solver ||
      frame.growthAttempts !== this.growthAttempts ||
      frame.scaleFactor !== this.scaleFactor ||
      this.growthAttempts !== 0 ||
      this.scaleFactor !== 1 ||
      !Number.isInteger(this.maxGrowthAttempts) ||
      this.maxGrowthAttempts < 1 ||
      !Number.isInteger(this.minimumGrowthAttempts) ||
      this.minimumGrowthAttempts > 1 ||
      this.constructorParams.growShrinkSolutionValidator ||
      this.constructorParams.cacheProvider !== undefined ||
      this.step !== nativeBaseStep ||
      this._step !== nativeGrowthStep ||
      this.createActiveSubSolver !== nativeCreateActiveSubSolver ||
      this.acceptSolution !== nativeAcceptSolution ||
      Object.getPrototypeOf(solver) !==
        PortfolioSingleIntraNodeSolver.prototype ||
      solver.step !== nativeBaseStep ||
      solver._step !== nativePortfolioStep ||
      HyperParameterSupervisorSolver.prototype._step !== nativeSupervisorStep ||
      solver.initializeSolvers !== nativeInitializeSolvers ||
      solver.getCombinationDefs !== nativeGetCombinationDefs ||
      solver.getHyperParameterDefs !== nativeGetHyperParameterDefs ||
      solver.getHyperParameterCombinations !==
        nativeGetHyperParameterCombinations ||
      solver.generateSolver !== nativeGenerateSolver ||
      solver.computeG !== nativeComputeG ||
      solver.computeH !== nativeComputeH ||
      solver.computeF !== nativeComputeF ||
      solver.getSupervisedSolverWithBestFitness !== nativeSelectBestFitness ||
      solver.MIN_SUBSTEPS !== 100 ||
      solver.GREEDY_MULTIPLIER !== 5 ||
      solver.adaptiveSearchExpanded ||
      !solver.supervisedSolvers
    ) {
      return false
    }

    const node = this.nodeWithPortPoints
    const segmentCount = Math.max(
      1,
      node.portPointsInPairs?.length ??
        new Set(node.portPoints.map((point) => point.connectionName)).size,
    )
    const routingPitch =
      (this.constructorParams.traceWidth ?? 0.15) +
      (this.constructorParams.obstacleMargin ?? 0.1)
    const channelWidth =
      segmentCount * routingPitch + (this.constructorParams.viaDiameter ?? 0.3)
    // This estimates routing pressure only to choose attempt order. Every
    // suspended candidate retains its original work and search limit.
    if (Math.min(node.width, node.height) > channelWidth) {
      // A spacious attempt keeps its native order even if later caller edits
      // increase pressure. Cache only this decision to retain native order.
      frame.spaciousNode = true
      return false
    }

    if (!frame.initialCachedProbes) {
      let firstProbe: CachedIntraNodeRouteSolver | undefined
      let secondProbe: CachedIntraNodeRouteSolver | undefined
      let cachedProbeCount = 0
      for (const candidate of solver.supervisedSolvers) {
        if (!(candidate.solver instanceof CachedIntraNodeRouteSolver)) continue
        cachedProbeCount++
        if (!firstProbe) {
          firstProbe = candidate.solver
          continue
        }
        if (!secondProbe) secondProbe = candidate.solver
      }
      if (!firstProbe || !secondProbe) {
        throw new Error(
          "Early growth requires both original native cached probes",
        )
      }
      // Keep the original native probes even if this attempt later expands.
      // Their actual work chooses when to try the existing next scale.
      frame.initialCachedProbes = [firstProbe, secondProbe]
      frame.initialCachedProbeCount = cachedProbeCount
    }

    for (const probe of frame.initialCachedProbes) {
      if (
        !probe.solved &&
        !probe.failed &&
        probe.iterations < solver.MIN_SUBSTEPS
      ) {
        return false
      }
    }
    const workDescriptor = Object.getOwnPropertyDescriptor(
      solver,
      "totalCandidateWork",
    )
    if (
      frame.initialCachedProbeCount === null ||
      !workDescriptor ||
      !("value" in workDescriptor) ||
      !Number.isFinite(workDescriptor.value) ||
      workDescriptor.value < 0
    ) {
      throw new Error("Early growth requires native original candidate work")
    }
    // Give the original portfolio meaningful aggregate exploration before
    // interrupting it. This uses real non-negotiated work, not scheduling
    // credits or a guarantee that every cached probe received a batch.
    const originalWarmupWork =
      frame.initialCachedProbeCount * solver.MIN_SUBSTEPS * solver.GREEDY_MULTIPLIER
    return workDescriptor.value >= originalWarmupWork
  }

  private hasEarlyGrownCopperConflict(
    solver: PortfolioSingleIntraNodeSolver,
  ): boolean {
    const connMap = this.constructorParams.connMap
    if (!connMap) {
      throw new Error("Early growth screening requires its connectivity map")
    }
    const routes = solver.solvedRoutes.map((route) =>
      scaleRoute(route, this.nodeWithPortPoints.center, 1 / this.scaleFactor),
    )
    const clearance = Math.max(
      this.constructorParams.obstacleMargin ?? 0.1,
      0.1,
    )
    for (let leftIndex = 0; leftIndex < routes.length; leftIndex++) {
      const left = routes[leftIndex]!
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < routes.length;
        rightIndex++
      ) {
        const right = routes[rightIndex]!
        if (arePipeline9RoutesOnSameNet(left, right, connMap)) continue
        if (
          doPipeline9RoutesHaveCopperConflict({
            left,
            right,
            clearance,
            layerCount: this.constructorParams.layerCount ?? 2,
          })
        ) {
          return true
        }
      }
    }
    return false
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
    return Math.min(
      0.99,
      (this.growthAttempts + (this.activeSubSolver?.progress ?? 0)) /
        (this.maxGrowthAttempts + 1),
    )
  }

  _step() {
    if (!this.activeSubSolver) {
      this.createActiveSubSolver()
    }

    this.activeSubSolver!.step()

    if (this.activeSubSolver!.solved) {
      if (
        this.suspendedInitialAttempt &&
        this.hasEarlyGrownCopperConflict(this.activeSubSolver!)
      ) {
        const grownFrame = this.activeAttemptFrame
        if (!grownFrame || grownFrame.solver !== this.activeSubSolver) {
          throw new Error("Early grown solution lost its owned attempt frame")
        }
        // A known physical conflict restores the original attempt order. Keep
        // this solved attempt available if the original search also fails.
        this.deferredSolvedAttempt = grownFrame
        const originalFrame = this.suspendedInitialAttempt
        this.suspendedInitialAttempt = null
        this.activeSubSolver = originalFrame.solver
        this.activeAttemptFrame = originalFrame
        this.growthAttempts = originalFrame.growthAttempts
        this.scaleFactor = originalFrame.scaleFactor
        return
      }
      if (this.acceptSolution(this.activeSubSolver!)) {
        this.activeSubSolver = null
        this.activeAttemptFrame = null
        this.suspendedInitialAttempt = null
        this.deferredSolvedAttempt = null
        return
      }
    }

    if (!this.activeSubSolver!.failed) {
      if (this.shouldTryNextScaleEarly()) {
        this.suspendedInitialAttempt = this.activeAttemptFrame
        this.earlyGrowthAttemptTried = true
        this.activeSubSolver = null
        this.activeAttemptFrame = null
        this.growthAttempts = 1
        this.scaleFactor = 2
      }
      return
    }

    this.failedSolvers.push(this.activeSubSolver!)
    this.error = this.activeSubSolver!.error
    this.activeSubSolver = null
    this.activeAttemptFrame = null

    if (this.suspendedInitialAttempt) {
      const frame = this.suspendedInitialAttempt
      this.suspendedInitialAttempt = null
      this.activeSubSolver = frame.solver
      this.activeAttemptFrame = frame
      this.growthAttempts = frame.growthAttempts
      this.scaleFactor = frame.scaleFactor
      return
    }

    if (this.deferredSolvedAttempt) {
      const frame = this.deferredSolvedAttempt
      this.deferredSolvedAttempt = null
      this.activeSubSolver = frame.solver
      this.activeAttemptFrame = frame
      this.growthAttempts = frame.growthAttempts
      this.scaleFactor = frame.scaleFactor
      // Its native search already finished. Accept at the original attempt's
      // failure without advancing the solved portfolio or spending another step.
      if (this.acceptSolution(frame.solver)) {
        this.activeSubSolver = null
        this.activeAttemptFrame = null
        return
      }
      this.failedSolvers.push(frame.solver)
      this.error = frame.solver.error
      this.activeSubSolver = null
      this.activeAttemptFrame = null
    }

    if (
      this.growthAttempts >= this.maxGrowthAttempts ||
      (this.earlyGrowthAttemptTried &&
        this.growthAttempts === 0 &&
        this.maxGrowthAttempts === 1)
    ) {
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
    if (this.earlyGrowthAttemptTried && this.growthAttempts === 1) {
      this.growthAttempts++
    }
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

const nativeGrowthStep = GrowShrinkHighDensityIntraNodeSolver.prototype._step
const nativeBaseStep = BaseSolver.prototype.step
const nativePortfolioStep = PortfolioSingleIntraNodeSolver.prototype._step
const nativeSupervisorStep = HyperParameterSupervisorSolver.prototype._step
const nativeCreateActiveSubSolver: (
  this: GrowShrinkHighDensityIntraNodeSolver,
) => void = Object.getOwnPropertyDescriptor(
  GrowShrinkHighDensityIntraNodeSolver.prototype,
  "createActiveSubSolver",
)!.value
const nativeAcceptSolution: (
  this: GrowShrinkHighDensityIntraNodeSolver,
  solver: PortfolioSingleIntraNodeSolver,
) => boolean = Object.getOwnPropertyDescriptor(
  GrowShrinkHighDensityIntraNodeSolver.prototype,
  "acceptSolution",
)!.value
const nativeInitializeSolvers =
  PortfolioSingleIntraNodeSolver.prototype.initializeSolvers
const nativeGetCombinationDefs =
  PortfolioSingleIntraNodeSolver.prototype.getCombinationDefs
const nativeGetHyperParameterDefs =
  PortfolioSingleIntraNodeSolver.prototype.getHyperParameterDefs
const nativeGetHyperParameterCombinations =
  PortfolioSingleIntraNodeSolver.prototype.getHyperParameterCombinations
const nativeGenerateSolver =
  PortfolioSingleIntraNodeSolver.prototype.generateSolver
const nativeComputeG = PortfolioSingleIntraNodeSolver.prototype.computeG
const nativeComputeH = PortfolioSingleIntraNodeSolver.prototype.computeH
const nativeComputeF = PortfolioSingleIntraNodeSolver.prototype.computeF
const nativeSelectBestFitness =
  PortfolioSingleIntraNodeSolver.prototype.getSupervisedSolverWithBestFitness
