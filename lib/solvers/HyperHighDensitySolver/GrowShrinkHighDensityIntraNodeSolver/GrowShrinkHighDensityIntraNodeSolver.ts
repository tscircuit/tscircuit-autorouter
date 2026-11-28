import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
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
    preservePhysicalGeometry?: boolean
    growShrinkSolutionValidator?: (
      routes: HighDensityIntraNodeRoute[],
    ) => boolean
  }

type CoordinateScale = {
  center: { x: number; y: number }
  scaleFactor: number
}

type RouteScale = CoordinateScale & {
  copperScaleFactor?: number
}

const scalePoint = <Point extends { x: number; y: number }>(
  point: Point,
  { center, scaleFactor }: CoordinateScale,
): Point => ({
  ...point,
  x: center.x + (point.x - center.x) * scaleFactor,
  y: center.y + (point.y - center.y) * scaleFactor,
})

const scaleNodeWithPortPoints = (
  node: NodeWithPortPoints,
  scaleFactor: number,
): NodeWithPortPoints => ({
  ...node,
  width: node.width * scaleFactor,
  height: node.height * scaleFactor,
  portPoints: node.portPoints.map((portPoint) =>
    scalePoint(portPoint, { center: node.center, scaleFactor }),
  ),
  portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
    scalePoint(start, { center: node.center, scaleFactor }),
    scalePoint(end, { center: node.center, scaleFactor }),
  ]),
})

const scaleRoute = (
  route: HighDensityIntraNodeRoute,
  { center, scaleFactor, copperScaleFactor }: RouteScale,
): HighDensityIntraNodeRoute => {
  const scaledRoute: HighDensityIntraNodeRoute = {
    ...route,
    route: route.route.map((point) => {
      const scaledPoint = scalePoint(point, { center, scaleFactor })
      if (
        copperScaleFactor === undefined ||
        point.traceThickness === undefined
      ) {
        return scaledPoint
      }
      return {
        ...scaledPoint,
        traceThickness: point.traceThickness * copperScaleFactor,
      }
    }),
    vias: route.vias.map((via) => scalePoint(via, { center, scaleFactor })),
    jumpers: route.jumpers?.map((jumper) => ({
      ...jumper,
      start: scalePoint(jumper.start, { center, scaleFactor }),
      end: scalePoint(jumper.end, { center, scaleFactor }),
    })),
  }
  if (copperScaleFactor === undefined) return scaledRoute
  return {
    ...scaledRoute,
    traceThickness: route.traceThickness * copperScaleFactor,
    viaDiameter: route.viaDiameter * copperScaleFactor,
  }
}

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
  coordinateScale = 1
  readonly preservePhysicalGeometry: boolean
  scaleFactor = 1
  growthAttempts = 0
  maxGrowthAttempts: number
  minimumGrowthAttempts: number

  constructor(params: GrowShrinkHighDensityIntraNodeSolverParams) {
    super()
    this.constructorParams = params
    this.preservePhysicalGeometry =
      params.preservePhysicalGeometry ?? Boolean(params.fixedHdRoutes?.length)
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

  private createActiveSubSolver(): void {
    const { growShrinkSolutionValidator, ...portfolioParams } =
      this.constructorParams
    this.coordinateScale = this.scaleFactor
    if (this.preservePhysicalGeometry) {
      this.coordinateScale = Math.min(2, this.scaleFactor)
    }
    const nodeWithPortPoints = scaleNodeWithPortPoints(
      this.nodeWithPortPoints,
      this.coordinateScale,
    )
    let metalScale = 1
    if (this.preservePhysicalGeometry) metalScale = this.coordinateScale
    portfolioParams.fixedHdRoutes = portfolioParams.fixedHdRoutes?.map(
      (route) =>
        scaleRoute(route, {
          center: this.nodeWithPortPoints.center,
          scaleFactor: this.coordinateScale,
          copperScaleFactor: metalScale,
        }),
    )
    if (this.preservePhysicalGeometry) {
      // Expand by physical copper clearance rather than preserving a skinny
      // cell's aspect ratio or magnifying its long side into a huge search grid.
      const clearanceRadius =
        (this.constructorParams.viaDiameter ?? 0.3) / 2 +
        (this.constructorParams.traceWidth ?? 0.15) / 2 +
        (this.constructorParams.obstacleMargin ?? 0.15)
      const growth = 2 * (this.scaleFactor - 1) *
        clearanceRadius * this.coordinateScale
      nodeWithPortPoints.width += growth
      nodeWithPortPoints.height += growth
      this.scalePhysicalConstraints(portfolioParams)
    }
    this.activeSubSolver = new PortfolioSingleIntraNodeSolver({
      ...portfolioParams,
      preservePhysicalGeometry: this.preservePhysicalGeometry,
      // The search emits local coordinates; copper guards consume board-world mm.
      priorityCoordinateScale:
        (portfolioParams.priorityCoordinateScale ?? 1) * this.coordinateScale,
      enableNegotiatedSearch:
        this.scaleFactor === 1 &&
        (portfolioParams.enableNegotiatedSearch ?? true),
      nodeWithPortPoints,
      solutionValidator: growShrinkSolutionValidator
        ? (routes): boolean =>
            growShrinkSolutionValidator(this.getUnscaledRoutes(routes))
        : undefined,
    })
    if (this.constructorParams.maxInnerIterationsPerGrowthAttempt) {
      this.activeSubSolver.MAX_ITERATIONS =
        this.constructorParams.maxInnerIterationsPerGrowthAttempt
    }
  }

  private scalePhysicalConstraints(
    portfolioParams: PortfolioSingleIntraNodeSolverParams,
  ): void {
    // Grow physical bounds while refining the existing search grid once.
    // Terminals, copper, pads and clearances must use the same search frame.
    const center = this.nodeWithPortPoints.center
    const scale = this.coordinateScale
    portfolioParams.traceWidth = (portfolioParams.traceWidth ?? 0.15) * scale
    portfolioParams.viaDiameter = (portfolioParams.viaDiameter ?? 0.3) * scale
    portfolioParams.obstacleMargin =
      (portfolioParams.obstacleMargin ?? 0.15) * scale
    portfolioParams.reservedTerminals = portfolioParams.reservedTerminals?.map((terminal) => ({
      ...scalePoint(terminal, { center, scaleFactor: scale }),
      traceThickness: terminal.traceThickness * scale,
    }))
    portfolioParams.obstacles = portfolioParams.obstacles?.map((obstacle) => ({
      ...obstacle,
      center: scalePoint(obstacle.center, { center, scaleFactor: scale }),
      width: obstacle.width * scale,
      height: obstacle.height * scale,
    }))
    if (portfolioParams.boardGeometry) {
      const geometry = portfolioParams.boardGeometry
      const bounds = geometry.bounds
      portfolioParams.boardGeometry = {
        ...geometry,
        bounds: {
          minX: center.x + (bounds.minX - center.x) * scale,
          maxX: center.x + (bounds.maxX - center.x) * scale,
          minY: center.y + (bounds.minY - center.y) * scale,
          maxY: center.y + (bounds.maxY - center.y) * scale,
        },
        outline: geometry.outline?.map((point) =>
          scalePoint(point, { center, scaleFactor: scale }),
        ),
      }
      if (geometry.minBoardEdgeClearance !== undefined) {
        portfolioParams.boardGeometry.minBoardEdgeClearance =
          geometry.minBoardEdgeClearance * scale
      }
    }
    portfolioParams.precomputedIntraNodeRouteParams = undefined
  }

  private getUnscaledRoutes(
    routes: HighDensityIntraNodeRoute[],
  ): HighDensityIntraNodeRoute[] {
    if (this.coordinateScale === 1) return routes
    let copperScaleFactor: number | undefined
    if (this.preservePhysicalGeometry) {
      copperScaleFactor = 1 / this.coordinateScale
    }
    return routes.map((route) =>
      scaleRoute(route, {
        center: this.nodeWithPortPoints.center,
        scaleFactor: 1 / this.coordinateScale,
        copperScaleFactor,
      }),
    )
  }

  private acceptSolution(solver: PortfolioSingleIntraNodeSolver): void {
    this.winningSolver = solver
    this.error = null
    this.solvedRoutes = this.getUnscaledRoutes(solver.solvedRoutes)
    this.solved = true
    this.failed = false
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
      this.acceptSolution(this.activeSubSolver!)
      this.activeSubSolver = null
      return
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
