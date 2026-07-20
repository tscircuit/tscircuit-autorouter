import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import { GraphicsObject } from "graphics-debug"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import type { DrcEvaluator } from "high-density-repair03/lib"

type Phase = "via_removal" | "via_merging" | "path_simplification"

type RouteComplexity = {
  viaCount: number
  routePointCount: number
  totalTraceLength: number
}
type DrcQuality = {
  issueCount: number
  issueScore: number
}

type SimplificationStrategy = {
  enableGeometryShortcuts: boolean
  geometryShortcutTraceMargin: number
  geometryShortcutObstacleMarginScale: number
  nearViaMergeDistanceMultiplier: number
  pathMaxStepSize: number
  pathTailJumpRatio: number
}

export interface TraceSimplificationSolverConfig {
  readonly hdRoutes: ReadonlyArray<HighDensityRoute>
  readonly obstacles: ReadonlyArray<Obstacle>
  readonly connMap: ConnectivityMap
  readonly colorMap: Readonly<Record<string, string>>
  readonly outline?: ReadonlyArray<{ x: number; y: number }>
  readonly defaultViaDiameter: number
  readonly layerCount: number
  readonly minTraceToPadEdgeClearance?: number
  readonly effort?: number
  readonly drcEvaluator?: DrcEvaluator
  readonly preserveInitialDrcCheckpoint?: boolean
}

const VIA_INSIDE_OBSTACLE_TOLERANCE = 1e-6
const TRACE_LENGTH_IMPROVEMENT_TOLERANCE = 1e-6
const DRC_SCORE_IMPROVEMENT_TOLERANCE = 1e-9
const MIN_LOOPS_BEFORE_CONVERGENCE = 2
const MAX_NON_IMPROVING_STRATEGIES = 2
const SIMPLIFICATION_STRATEGIES: readonly SimplificationStrategy[] = [
  {
    enableGeometryShortcuts: false,
    geometryShortcutTraceMargin: 0.1,
    geometryShortcutObstacleMarginScale: 1,
    nearViaMergeDistanceMultiplier: 2.5,
    pathMaxStepSize: 4,
    pathTailJumpRatio: 0.8,
  },
  {
    enableGeometryShortcuts: true,
    geometryShortcutTraceMargin: 0.1,
    geometryShortcutObstacleMarginScale: 1,
    nearViaMergeDistanceMultiplier: 2.5,
    pathMaxStepSize: 4,
    pathTailJumpRatio: 0.8,
  },
  {
    enableGeometryShortcuts: true,
    geometryShortcutTraceMargin: 0.075,
    geometryShortcutObstacleMarginScale: 0.85,
    nearViaMergeDistanceMultiplier: 3.25,
    pathMaxStepSize: 2,
    pathTailJumpRatio: 0.7,
  },
  {
    enableGeometryShortcuts: true,
    geometryShortcutTraceMargin: 0.05,
    geometryShortcutObstacleMarginScale: 0.7,
    nearViaMergeDistanceMultiplier: 4,
    pathMaxStepSize: 8,
    pathTailJumpRatio: 0.9,
  },
  {
    enableGeometryShortcuts: true,
    geometryShortcutTraceMargin: 0.025,
    geometryShortcutObstacleMarginScale: 0.5,
    nearViaMergeDistanceMultiplier: 5,
    pathMaxStepSize: 1,
    pathTailJumpRatio: 0.6,
  },
  {
    enableGeometryShortcuts: true,
    geometryShortcutTraceMargin: 0.15,
    geometryShortcutObstacleMarginScale: 1.2,
    nearViaMergeDistanceMultiplier: 3,
    pathMaxStepSize: 6,
    pathTailJumpRatio: 0.75,
  },
]

const getRouteComplexity = (
  routes: ReadonlyArray<HighDensityRoute>,
  connMap: ConnectivityMap,
): RouteComplexity => {
  const physicalViaKeys = new Set<string>()
  let routePointCount = 0
  let totalTraceLength = 0

  for (const route of routes) {
    const net =
      connMap.idToNetMap[route.connectionName] ??
      (route.rootConnectionName
        ? connMap.idToNetMap[route.rootConnectionName]
        : undefined) ??
      route.rootConnectionName ??
      route.connectionName
    routePointCount += route.route.length
    for (let index = 1; index < route.route.length; index += 1) {
      const previousPoint = route.route[index - 1]!
      const point = route.route[index]!
      if (
        previousPoint.z !== point.z &&
        Math.abs(previousPoint.x - point.x) <= 1e-3 &&
        Math.abs(previousPoint.y - point.y) <= 1e-3
      ) {
        physicalViaKeys.add(
          `${net}:${point.x.toFixed(3)}:${point.y.toFixed(3)}`,
        )
      }
      totalTraceLength += Math.hypot(
        point.x - previousPoint.x,
        point.y - previousPoint.y,
      )
    }
  }

  return {
    viaCount: physicalViaKeys.size,
    routePointCount,
    totalTraceLength,
  }
}

const isRouteComplexityImprovement = (
  previous: RouteComplexity,
  current: RouteComplexity,
): boolean => {
  if (current.viaCount !== previous.viaCount) {
    return current.viaCount < previous.viaCount
  }
  if (current.routePointCount !== previous.routePointCount) {
    return current.routePointCount < previous.routePointCount
  }

  return (
    current.totalTraceLength <
    previous.totalTraceLength - TRACE_LENGTH_IMPROVEMENT_TOLERANCE
  )
}

const getDrcQuality = (
  evaluator: DrcEvaluator | undefined,
  routes: HighDensityRoute[],
): DrcQuality => {
  if (!evaluator) return { issueCount: 0, issueScore: 0 }
  const result = evaluator({ traces: [], routes, hdRoutes: routes })
  const errors = Array.isArray(result) ? result : result.errors
  let issueScore = 0
  for (const error of errors) {
    const message = typeof error.message === "string" ? error.message : ""
    const gap = Number.parseFloat(
      message.match(/gap: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
    )
    const required = Number.parseFloat(
      message.match(/required: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
    )
    issueScore +=
      Number.isFinite(gap) && Number.isFinite(required)
        ? Math.max(0, required - gap)
        : 1
  }
  return { issueCount: errors.length, issueScore }
}

const pointInsideObstacle = (
  point: { x: number; y: number },
  obstacle: Obstacle,
) =>
  Math.abs(point.x - obstacle.center.x) <=
    obstacle.width / 2 + VIA_INSIDE_OBSTACLE_TOLERANCE &&
  Math.abs(point.y - obstacle.center.y) <=
    obstacle.height / 2 + VIA_INSIDE_OBSTACLE_TOLERANCE

const isMultilayerObstacle = (obstacle: Obstacle) =>
  (obstacle.__zLayers?.length ?? obstacle.layers?.length ?? 0) > 1

/**
 * TraceSimplificationSolver consolidates trace optimization by iteratively applying
 * via removal, via merging, and path simplification phases. It reduces redundant vias
 * and simplifies routing paths through configurable iterations.
 *
 * The solver operates in three alternating phases per iteration:
 * 1. "via_removal" - Removes unnecessary vias from routes using UselessViaRemovalSolver
 * 2. "via_merging" - Merges redundant vias on the same net using SameNetViaMergerSolver
 * 3. "path_simplification" - Simplifies routing paths using MultiSimplifiedPathSolver
 *
 * Each iteration consists of all phases executed sequentially.
 */
export class TraceSimplificationSolver extends BaseSolver {
  override getSolverName(): string {
    return "TraceSimplificationSolver"
  }

  hdRoutes: HighDensityRoute[] = []

  simplificationPipelineLoops = 0

  SIMPLIFICATION_STRATEGY_LIMIT: number

  PHASE_ORDER: Phase[] = ["via_removal", "via_merging", "path_simplification"]

  currentPhase: Phase = "via_removal"

  /** Callback to extract results from the active sub-solver */
  extractResult: ((solver: BaseSolver) => HighDensityRoute[]) | null = null

  private bestRouteComplexity: RouteComplexity

  private bestHdRoutes: HighDensityRoute[]

  private bestDrcIssueCount: number

  private bestDrcIssueScore: number

  private readonly initialDrcIssueCount: number

  private nonImprovingStrategyCount = 0

  /** Returns the simplified routes. This is the primary output of the solver. */
  get simplifiedHdRoutes(): HighDensityRoute[] {
    return this.hdRoutes
  }

  /**
   * Creates a new TraceSimplificationSolver
   * @param simplificationConfig Configuration object containing:
   *   - hdRoutes: Initial high-density routes to simplify
   *   - obstacles: Board obstacles to avoid during simplification
   *   - connMap: Connectivity map for routing validation
   *   - colorMap: Mapping of net names to colors for visualization
   *   - outline: Optional board outline boundary
   *   - defaultViaDiameter: Default diameter for vias
   *   - layerCount: Number of routing layers
   *   - minTraceToPadEdgeClearance: Minimum trace-edge clearance to pads/vias
   *   - effort: Scales the number of bounded simplification strategies.
   *     Every effort uses the same ordered strategy portfolio and stops when
   *     those strategies stop improving the best route.
   */
  constructor(
    private readonly simplificationConfig: TraceSimplificationSolverConfig,
  ) {
    super()
    const requestedEffort = simplificationConfig.effort ?? 1
    const effortScale = Number.isFinite(requestedEffort)
      ? Math.max(1, requestedEffort)
      : 1
    this.SIMPLIFICATION_STRATEGY_LIMIT = Math.min(
      SIMPLIFICATION_STRATEGIES.length,
      2 + Math.ceil(Math.log2(effortScale)),
    )
    this.simplificationConfig = {
      ...simplificationConfig,
      obstacles: createObjectsWithZLayers(
        simplificationConfig.obstacles,
        simplificationConfig.layerCount,
      ),
    }
    this.hdRoutes = this.markThroughObstacleSegments(
      simplificationConfig.hdRoutes,
    )
    this.bestRouteComplexity = getRouteComplexity(
      this.hdRoutes,
      this.simplificationConfig.connMap,
    )
    this.bestHdRoutes = structuredClone(this.hdRoutes)
    const initialDrcQuality = getDrcQuality(
      simplificationConfig.drcEvaluator,
      this.hdRoutes,
    )
    this.bestDrcIssueCount = initialDrcQuality.issueCount
    this.bestDrcIssueScore = initialDrcQuality.issueScore
    this.initialDrcIssueCount = initialDrcQuality.issueCount
    this.MAX_ITERATIONS = 100e6
  }

  private finishSimplification(stoppedAfterNoImprovement: boolean): void {
    this.hdRoutes = structuredClone(this.bestHdRoutes)
    this.stats = {
      simplificationPipelineLoops: this.simplificationPipelineLoops,
      simplificationStoppedAfterNoImprovement: stoppedAfterNoImprovement,
      simplificationStrategyLimit: this.SIMPLIFICATION_STRATEGY_LIMIT,
      simplificationInitialDrcIssueCount: this.initialDrcIssueCount,
      simplificationFinalDrcIssueCount: this.bestDrcIssueCount,
      simplificationFinalDrcIssueScore: this.bestDrcIssueScore,
    }
    this.solved = true
  }

  private isSameNetObstacle(route: HighDensityRoute, obstacle: Obstacle) {
    return obstacle.connectedTo.some(
      (connectedId) =>
        connectedId === route.connectionName ||
        connectedId === route.rootConnectionName ||
        this.simplificationConfig.connMap.areIdsConnected(
          route.connectionName,
          connectedId,
        ) ||
        (route.rootConnectionName !== undefined &&
          this.simplificationConfig.connMap.areIdsConnected(
            route.rootConnectionName,
            connectedId,
          )),
    )
  }

  private getSameNetObstacleForSegment(
    route: HighDensityRoute,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    return this.simplificationConfig.obstacles.find(
      (obstacle) =>
        isMultilayerObstacle(obstacle) &&
        this.isSameNetObstacle(route, obstacle) &&
        pointInsideObstacle(start, obstacle) &&
        pointInsideObstacle(end, obstacle),
    )
  }

  private isViaInsideSameNetObstacle(
    route: HighDensityRoute,
    via: { x: number; y: number },
  ) {
    return this.simplificationConfig.obstacles.some(
      (obstacle) =>
        isMultilayerObstacle(obstacle) &&
        this.isSameNetObstacle(route, obstacle) &&
        pointInsideObstacle(via, obstacle),
    )
  }

  markThroughObstacleSegments(
    routes: ReadonlyArray<HighDensityRoute>,
  ): HighDensityRoute[] {
    return routes.map((route) => {
      const vias = route.route.flatMap((point, index, points) => {
        const nextPoint = points[index + 1]
        if (!nextPoint || point.z === nextPoint.z) return []
        if (
          Math.abs(point.x - nextPoint.x) > 1e-3 ||
          Math.abs(point.y - nextPoint.y) > 1e-3
        ) {
          return []
        }
        return [{ x: point.x, y: point.y }]
      })

      return {
        ...route,
        route: route.route.map((point, index, points) => {
          const nextPoint = points[index + 1]
          if (
            nextPoint &&
            point.z !== nextPoint.z &&
            this.getSameNetObstacleForSegment(route, point, nextPoint)
          ) {
            return {
              ...point,
              toNextSegmentType: "through_obstacle" as const,
            }
          }

          return { ...point }
        }),
        vias: vias.filter(
          (via) => !this.isViaInsideSameNetObstacle(route, via),
        ),
      }
    })
  }

  _step() {
    if (this.simplificationPipelineLoops >= this.SIMPLIFICATION_STRATEGY_LIMIT) {
      this.finishSimplification(false)
      return
    }

    // If we have an active sub-solver, let it run
    if (this.activeSubSolver) {
      this.activeSubSolver.step()

      if (!this.activeSubSolver.failed && !this.activeSubSolver.solved) {
        return
      }

      if (this.activeSubSolver.solved) {
        // Capture output using the registered callback
        if (this.extractResult) {
          this.hdRoutes = this.markThroughObstacleSegments(
            this.extractResult(this.activeSubSolver),
          )
        }

        // Clear activeSubSolver
        this.activeSubSolver = null
        this.extractResult = null

        // Advance phase
        if (this.currentPhase === "via_removal") {
          this.currentPhase = "via_merging"
        } else if (this.currentPhase === "via_merging") {
          this.currentPhase = "path_simplification"
        } else {
          this.currentPhase = "via_removal"
          this.simplificationPipelineLoops++

          const completedLoopComplexity = getRouteComplexity(
            this.hdRoutes,
            this.simplificationConfig.connMap,
          )
          const completedLoopDrcQuality = getDrcQuality(
            this.simplificationConfig.drcEvaluator,
            this.hdRoutes,
          )
          const loopImprovedRouteComplexity = isRouteComplexityImprovement(
            this.bestRouteComplexity,
            completedLoopComplexity,
          )
          const loopImprovedBestCandidate =
            completedLoopDrcQuality.issueCount < this.bestDrcIssueCount ||
            (completedLoopDrcQuality.issueCount === this.bestDrcIssueCount &&
              completedLoopDrcQuality.issueScore <
                this.bestDrcIssueScore - DRC_SCORE_IMPROVEMENT_TOLERANCE) ||
            (completedLoopDrcQuality.issueCount === this.bestDrcIssueCount &&
              Math.abs(
                completedLoopDrcQuality.issueScore - this.bestDrcIssueScore,
              ) <= DRC_SCORE_IMPROVEMENT_TOLERANCE &&
              loopImprovedRouteComplexity)
          const completedBaselineCheckpoint =
            !this.simplificationConfig.preserveInitialDrcCheckpoint &&
            this.simplificationPipelineLoops ===
              Math.min(
                MIN_LOOPS_BEFORE_CONVERGENCE,
                this.SIMPLIFICATION_STRATEGY_LIMIT,
              )

          if (completedBaselineCheckpoint || loopImprovedBestCandidate) {
            this.bestDrcIssueCount = completedLoopDrcQuality.issueCount
            this.bestDrcIssueScore = completedLoopDrcQuality.issueScore
            this.bestRouteComplexity = completedLoopComplexity
            this.bestHdRoutes = structuredClone(this.hdRoutes)
            this.nonImprovingStrategyCount = 0
          } else {
            this.nonImprovingStrategyCount += 1
          }

          if (
            this.simplificationPipelineLoops >=
              Math.min(
                this.SIMPLIFICATION_STRATEGY_LIMIT,
                this.SIMPLIFICATION_STRATEGY_LIMIT > MIN_LOOPS_BEFORE_CONVERGENCE
                  ? MIN_LOOPS_BEFORE_CONVERGENCE + 1
                  : MIN_LOOPS_BEFORE_CONVERGENCE,
              ) &&
            this.simplificationPipelineLoops <
              this.SIMPLIFICATION_STRATEGY_LIMIT &&
            this.nonImprovingStrategyCount >= MAX_NON_IMPROVING_STRATEGIES
          ) {
            this.finishSimplification(true)
            return
          }

          if (
            this.simplificationPipelineLoops >= MIN_LOOPS_BEFORE_CONVERGENCE
          ) {
            this.hdRoutes = structuredClone(this.bestHdRoutes)
          }
        }

        // Check if all iterations are complete
        if (
          this.simplificationPipelineLoops >= this.SIMPLIFICATION_STRATEGY_LIMIT
        ) {
          this.finishSimplification(false)
          return
        }
      } else if (this.activeSubSolver.failed) {
        this.failed = true
        this.error =
          this.activeSubSolver.error ??
          "Sub-solver failed without error message"
        return
      }
    }

    // No active sub-solver, start the next one
    if (!this.activeSubSolver && !this.solved) {
      const strategy =
        SIMPLIFICATION_STRATEGIES[this.simplificationPipelineLoops]!
      switch (this.currentPhase) {
        case "via_removal":
          this.activeSubSolver = new UselessViaRemovalSolver({
            unsimplifiedHdRoutes: this.hdRoutes,
            obstacles: [...this.simplificationConfig.obstacles],
            colorMap: { ...this.simplificationConfig.colorMap },
            layerCount: this.simplificationConfig.layerCount,
            connMap: this.simplificationConfig.connMap,
            outline: this.simplificationConfig.outline
              ? [...this.simplificationConfig.outline]
              : undefined,
            geometryShortcutTraceMargin: strategy.geometryShortcutTraceMargin,
            geometryShortcutObstacleMargin:
              (this.simplificationConfig.minTraceToPadEdgeClearance ?? 0.15) *
              strategy.geometryShortcutObstacleMarginScale,
            enableGeometryShortcuts: strategy.enableGeometryShortcuts,
          })
          this.extractResult = (s) =>
            (s as UselessViaRemovalSolver).getOptimizedHdRoutes() ?? []
          break

        case "via_merging":
          this.activeSubSolver = new SameNetViaMergerSolver({
            inputHdRoutes: this.hdRoutes,
            obstacles: [...this.simplificationConfig.obstacles],
            colorMap: { ...this.simplificationConfig.colorMap },
            layerCount: this.simplificationConfig.layerCount,
            connMap: this.simplificationConfig.connMap,
            outline: this.simplificationConfig.outline
              ? [...this.simplificationConfig.outline]
              : undefined,
            nearViaMergeDistanceMultiplier:
              strategy.nearViaMergeDistanceMultiplier,
          })
          this.extractResult = (s) =>
            (s as SameNetViaMergerSolver).getMergedViaHdRoutes() ?? []
          break

        case "path_simplification":
          this.activeSubSolver = new MultiSimplifiedPathSolver({
            unsimplifiedHdRoutes: this.hdRoutes,
            obstacles: [...this.simplificationConfig.obstacles],
            connMap: this.simplificationConfig.connMap,
            colorMap: { ...this.simplificationConfig.colorMap },
            outline: this.simplificationConfig.outline
              ? [...this.simplificationConfig.outline]
              : undefined,
            defaultViaDiameter: this.simplificationConfig.defaultViaDiameter,
            maxStepSize: strategy.pathMaxStepSize,
            tailJumpRatio: strategy.pathTailJumpRatio,
          })
          this.extractResult = (s) =>
            (s as MultiSimplifiedPathSolver).simplifiedHdRoutes
          break

        default:
          this.failed = true
          this.error = `Unknown phase: ${this.currentPhase}`
          break
      }
    }
  }

  visualize(): GraphicsObject {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    const visualization: GraphicsObject & {
      lines: NonNullable<GraphicsObject["lines"]>
      points: NonNullable<GraphicsObject["points"]>
      rects: NonNullable<GraphicsObject["rects"]>
      circles: NonNullable<GraphicsObject["circles"]>
    } = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: "Trace Simplification Solver",
    }

    // Visualize obstacles
    for (const obstacle of this.simplificationConfig.obstacles) {
      let fillColor = "rgba(128, 128, 128, 0.2)"
      const isOnLayer0 = obstacle.__zLayers?.includes(0)
      const isOnLayer1 = obstacle.__zLayers?.includes(1)

      if (isOnLayer0 && isOnLayer1) {
        fillColor = "rgba(128, 0, 128, 0.2)"
      } else if (isOnLayer0) {
        fillColor = "rgba(255, 0, 0, 0.2)"
      } else if (isOnLayer1) {
        fillColor = "rgba(0, 0, 255, 0.2)"
      }

      visualization.rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: fillColor,
        label: `Obstacle (Z: ${obstacle.__zLayers?.join(", ")})`,
      })
    }

    // Draw output routes and vias
    for (const route of this.hdRoutes) {
      if (route.route.length === 0) continue

      // Draw lines connecting route points on the same layer
      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]
        const next = route.route[i + 1]

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: current.z === 0 ? "red" : "blue",
            strokeWidth: route.traceThickness,
            label: `${route.connectionName} (z=${current.z})`,
          })
        }
      }

      // Draw circles for vias
      for (const via of route.vias) {
        visualization.circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(255, 0, 255, 0.5)",
          label: `${route.connectionName} via`,
        })
      }

      // Draw jumpers
      if (route.jumpers && route.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(route.jumpers, {
          color: "orange",
          label: route.connectionName,
        })
        visualization.rects.push(...(jumperGraphics.rects ?? []))
        visualization.lines.push(...(jumperGraphics.lines ?? []))
      }
    }

    return visualization
  }
}
