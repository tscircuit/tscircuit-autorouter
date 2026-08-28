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

type PortfolioSingleIntraNodeSolverParams = Omit<
  ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0],
  "maxSupervisorIterations"
>

export const DEFAULT_MAX_GROWTH_ATTEMPTS = 3

export type GrowShrinkHighDensityIntraNodeSolverParams =
  PortfolioSingleIntraNodeSolverParams & {
    maxGrowthAttempts?: number
    maxInnerIterationsPerGrowthAttempt?: number
    maxInitialScaleSupervisorIterations?: number
    maxTotalGrownScaleSupervisorIterations?: number
    /**
     * Repair-pipeline optimization. Enlarged solutions shrink coordinates back
     * to the physical node, but their post-shrink geometry is unvalidated
     * unless a growShrinkSolutionValidator is supplied.
     */
    tryLargestScaleAsRepairSeedAfterInitialFailure?: boolean
    fallbackToInvalidGeometryOnFailure?: boolean
    /** Runs after an enlarged solution is shrunk to physical coordinates. */
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
  ...(route.jumpers
    ? {
        jumpers: route.jumpers.map((jumper) => ({
          ...jumper,
          start: scalePoint(jumper.start, center, scaleFactor),
          end: scalePoint(jumper.end, center, scaleFactor),
        })),
      }
    : {}),
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
  scaleFactorSequence: number[]
  readonly maxTotalGrownScaleSupervisorIterations?: number
  grownScaleSupervisorIterationsUsed = 0

  constructor(params: GrowShrinkHighDensityIntraNodeSolverParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.maxGrowthAttempts =
      params.maxGrowthAttempts ?? DEFAULT_MAX_GROWTH_ATTEMPTS
    this.maxTotalGrownScaleSupervisorIterations =
      params.maxTotalGrownScaleSupervisorIterations
    const ascendingScaleFactors = Array.from(
      { length: this.maxGrowthAttempts + 1 },
      (_, attempt) => 2 ** attempt,
    )
    this.scaleFactorSequence =
      params.tryLargestScaleAsRepairSeedAfterInitialFailure &&
      ascendingScaleFactors.length > 1
        ? [
            ascendingScaleFactors[0]!,
            ascendingScaleFactors[this.maxGrowthAttempts]!,
            ...ascendingScaleFactors.slice(1, -1),
          ]
        : ascendingScaleFactors
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
      maxGrowthAttempts: _maxGrowthAttempts,
      maxInnerIterationsPerGrowthAttempt,
      maxInitialScaleSupervisorIterations,
      maxTotalGrownScaleSupervisorIterations:
        _maxTotalGrownScaleSupervisorIterations,
      tryLargestScaleAsRepairSeedAfterInitialFailure:
        _tryLargestScaleAsRepairSeedAfterInitialFailure,
      fallbackToInvalidGeometryOnFailure: _fallbackToInvalidGeometryOnFailure,
      ...portfolioParams
    } = this.constructorParams
    const initialScaleSupervisorLimit =
      this.scaleFactor === 1 ? maxInitialScaleSupervisorIterations : undefined
    const remainingGrownScaleSupervisorIterations =
      this.scaleFactor > 1 &&
      this.maxTotalGrownScaleSupervisorIterations !== undefined
        ? Math.max(
            0,
            this.maxTotalGrownScaleSupervisorIterations -
              this.grownScaleSupervisorIterationsUsed,
          )
        : undefined
    const supervisorIterationLimits = [
      maxInnerIterationsPerGrowthAttempt,
      initialScaleSupervisorLimit,
      remainingGrownScaleSupervisorIterations,
    ].filter((limit): limit is number => limit !== undefined)
    const maxSupervisorIterations =
      supervisorIterationLimits.length > 0
        ? Math.min(...supervisorIterationLimits)
        : undefined
    this.activeSubSolver = new PortfolioSingleIntraNodeSolver({
      ...portfolioParams,
      nodeWithPortPoints: scaleNodeWithPortPoints(
        this.nodeWithPortPoints,
        this.scaleFactor,
      ),
      maxSupervisorIterations,
    })
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
    const solutionValidator = this.constructorParams.growShrinkSolutionValidator
    const validatorAccepted = solutionValidator
      ? solutionValidator(solvedRoutes)
      : undefined
    if (validatorAccepted === false) {
      solver.solved = false
      solver.failed = true
      solver.error = "High-density scale solution rejected by validator"
      return false
    }
    this.stats.acceptedScaleFactor = this.scaleFactor
    this.stats.postShrinkValidatorRan =
      this.scaleFactor > 1 && solutionValidator !== undefined
    this.stats.unvalidatedPostShrinkRepairSeed =
      this.scaleFactor > 1 && solutionValidator === undefined
    this.winningSolver = solver
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
      if (this.acceptSolution(this.activeSubSolver!)) {
        this.activeSubSolver = null
        return
      }
    }

    if (!this.activeSubSolver!.failed) {
      return
    }

    if (this.scaleFactor > 1) {
      this.grownScaleSupervisorIterationsUsed +=
        this.activeSubSolver!.iterations
      this.stats.grownScaleSupervisorIterationsUsed =
        this.grownScaleSupervisorIterationsUsed
    }
    this.failedSolvers.push(this.activeSubSolver!)
    this.error = this.activeSubSolver!.error
    this.activeSubSolver = null

    const grownScaleSupervisorBudgetExhausted =
      this.maxTotalGrownScaleSupervisorIterations !== undefined &&
      this.grownScaleSupervisorIterationsUsed >=
        this.maxTotalGrownScaleSupervisorIterations
    if (
      this.growthAttempts >= this.maxGrowthAttempts ||
      grownScaleSupervisorBudgetExhausted
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
          reason: grownScaleSupervisorBudgetExhausted
            ? "grown-scale supervisor budget exhausted"
            : "growth attempts exhausted",
          lastError: this.error,
        }
        this.error = null
        return
      }

      this.failed = true
      const attemptedScaleFactors = this.scaleFactorSequence.slice(
        0,
        this.growthAttempts + 1,
      )
      this.error = `GrowShrinkHighDensityIntraNodeSolver failed after trying scales ${attemptedScaleFactors.map((scaleFactor) => `${scaleFactor}x`).join(", ")}. Last error: ${this.error}`
      return
    }

    this.growthAttempts++
    this.scaleFactor = this.scaleFactorSequence[this.growthAttempts]!
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
