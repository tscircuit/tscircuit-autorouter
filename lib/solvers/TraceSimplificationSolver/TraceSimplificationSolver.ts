import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { Obstacle } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { BaseSolver } from "../BaseSolver"

type Phase =
  | "via_removal"
  | "crossing_via_reduction"
  | "via_merging"
  | "path_simplification"
  | "final_endpoint_via_removal"

const VIA_INSIDE_OBSTACLE_TOLERANCE = 1e-6

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
 * via removal, crossing via reduction, via merging, path simplification, and a
 * final endpoint-only pass. The second via-removal pass can route short local
 * detours around blocking pads while removing a via pair. The endpoint-only
 * pass runs last so its replacement geometry cannot block a larger reduction.
 *
 * The solver operates in four alternating phases per iteration, followed by a
 * final endpoint-only pass:
 * 1. "via_removal" - Removes unnecessary vias from routes using UselessViaRemovalSolver
 * 2. "crossing_via_reduction" - Swaps layer ownership at crossings to remove via pairs
 * 3. "via_merging" - Merges redundant vias on the same net using SameNetViaMergerSolver
 * 4. "path_simplification" - Simplifies routing paths using MultiSimplifiedPathSolver
 * 5. "final_endpoint_via_removal" - Reroutes multilayer endpoints to remove one via
 *
 * Each iteration consists of all phases executed sequentially.
 */
export class TraceSimplificationSolver extends BaseSolver {
  override getSolverName(): string {
    return "TraceSimplificationSolver"
  }

  hdRoutes: HighDensityRoute[] = []

  simplificationPipelineLoops = 0

  MAX_SIMPLIFICATION_PIPELINE_LOOPS: number = 2

  PHASE_ORDER: Phase[] = [
    "via_removal",
    "crossing_via_reduction",
    "via_merging",
    "path_simplification",
    "final_endpoint_via_removal",
  ]

  currentPhase: Phase = "via_removal"

  /** Callback to extract results from the active sub-solver */
  extractResult: ((solver: BaseSolver) => HighDensityRoute[]) | null = null

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
   *   - otherHdRoutes: Immutable routed traces to avoid while simplifying
   *   - netByConnectionName: Explicit net metadata for synthetic route names
   *   - enableCrossingViaReduction: Enables coordinated crossing layer swaps
   *   - enableEndpointViaRemoval: Runs the final endpoint-only via pass (default: true)
   *   - iterations: Number of complete simplification iterations (default: 2)
   */
  constructor(
    private readonly simplificationConfig: {
      readonly hdRoutes: ReadonlyArray<HighDensityRoute>
      readonly obstacles: ReadonlyArray<Obstacle>
      readonly connMap: ConnectivityMap
      readonly colorMap: Readonly<Record<string, string>>
      readonly outline?: ReadonlyArray<{ x: number; y: number }>
      readonly defaultViaDiameter: number
      readonly layerCount: number
      readonly minTraceToPadEdgeClearance?: number
      readonly otherHdRoutes?: ReadonlyArray<HighDensityRoute>
      readonly netByConnectionName?: ReadonlyMap<string, string>
      readonly enableCrossingViaReduction?: boolean
      readonly enableEndpointViaRemoval?: boolean
    },
  ) {
    super()
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
    this.MAX_ITERATIONS = 100e6
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
    return routes.map((route) => ({
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

        const finalizedPoint = { ...point }
        delete finalizedPoint.toNextSegmentType
        return finalizedPoint
      }),
      vias: route.vias.filter(
        (via) => !this.isViaInsideSameNetObstacle(route, via),
      ),
    }))
  }

  _step() {
    if (
      this.simplificationPipelineLoops >= this.MAX_SIMPLIFICATION_PIPELINE_LOOPS
    ) {
      this.solved = true
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
          this.currentPhase = this.simplificationConfig
            .enableCrossingViaReduction
            ? "crossing_via_reduction"
            : "via_merging"
        } else if (this.currentPhase === "crossing_via_reduction") {
          this.currentPhase = "via_merging"
        } else if (this.currentPhase === "via_merging") {
          this.currentPhase = "path_simplification"
        } else if (this.currentPhase === "path_simplification") {
          if (
            this.simplificationPipelineLoops + 1 >=
            this.MAX_SIMPLIFICATION_PIPELINE_LOOPS
          ) {
            if (this.simplificationConfig.enableEndpointViaRemoval === false) {
              this.currentPhase = "via_removal"
              this.simplificationPipelineLoops++
            } else {
              this.currentPhase = "final_endpoint_via_removal"
            }
          } else {
            this.currentPhase = "via_removal"
            this.simplificationPipelineLoops++
          }
        } else {
          this.currentPhase = "via_removal"
          this.simplificationPipelineLoops++
        }

        // Check if all iterations are complete
        if (
          this.simplificationPipelineLoops >=
          this.MAX_SIMPLIFICATION_PIPELINE_LOOPS
        ) {
          this.solved = true
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
      switch (this.currentPhase) {
        case "via_removal":
          this.activeSubSolver = new UselessViaRemovalSolver({
            unsimplifiedHdRoutes: this.hdRoutes,
            otherHdRoutes: [...(this.simplificationConfig.otherHdRoutes ?? [])],
            obstacles: [...this.simplificationConfig.obstacles],
            colorMap: { ...this.simplificationConfig.colorMap },
            layerCount: this.simplificationConfig.layerCount,
            connMap: this.simplificationConfig.connMap,
            outline: this.simplificationConfig.outline
              ? [...this.simplificationConfig.outline]
              : undefined,
            geometryShortcutTraceMargin: 0.1,
            geometryShortcutObstacleMargin:
              this.simplificationConfig.minTraceToPadEdgeClearance ?? 0.15,
            // Delay the quadratic anchor search until the first path pass has
            // reduced the route point count.
            enableGeometryShortcuts: this.simplificationPipelineLoops > 0,
            // Endpoint reroutes run only after every other simplifier so their
            // new geometry cannot block a larger reduction later in the pass.
            enableEndpointGeometryShortcuts: false,
            enableObstacleDetourShortcuts:
              this.simplificationConfig.enableCrossingViaReduction === true &&
              this.simplificationPipelineLoops > 0,
          })
          this.extractResult = (s) =>
            (s as UselessViaRemovalSolver).getOptimizedHdRoutes() ?? []
          break

        case "final_endpoint_via_removal":
          this.activeSubSolver = new UselessViaRemovalSolver({
            unsimplifiedHdRoutes: this.hdRoutes,
            otherHdRoutes: [...(this.simplificationConfig.otherHdRoutes ?? [])],
            obstacles: [...this.simplificationConfig.obstacles],
            colorMap: { ...this.simplificationConfig.colorMap },
            layerCount: this.simplificationConfig.layerCount,
            connMap: this.simplificationConfig.connMap,
            outline: this.simplificationConfig.outline
              ? [...this.simplificationConfig.outline]
              : undefined,
            geometryShortcutTraceMargin: 0.1,
            geometryShortcutObstacleMargin:
              this.simplificationConfig.minTraceToPadEdgeClearance ?? 0.15,
            enableGeometryShortcuts: false,
            enableEndpointGeometryShortcuts: true,
            enableObstacleDetourShortcuts: false,
            onlyEndpointLayerChanges: true,
          })
          this.extractResult = (s) =>
            (s as UselessViaRemovalSolver).getOptimizedHdRoutes() ?? []
          break

        case "crossing_via_reduction":
          this.activeSubSolver = new CrossingViaReductionSolver({
            inputHdRoutes: this.hdRoutes,
            otherHdRoutes: [...(this.simplificationConfig.otherHdRoutes ?? [])],
            obstacles: [...this.simplificationConfig.obstacles],
            connMap: this.simplificationConfig.connMap,
            layerCount: this.simplificationConfig.layerCount,
            outline: this.simplificationConfig.outline
              ? [...this.simplificationConfig.outline]
              : undefined,
            traceMargin: 0.1,
            obstacleMargin:
              this.simplificationConfig.minTraceToPadEdgeClearance ?? 0.15,
          })
          this.extractResult = (s) =>
            (s as CrossingViaReductionSolver).getReducedHdRoutes()
          break

        case "via_merging":
          this.activeSubSolver = new SameNetViaMergerSolver({
            inputHdRoutes: this.hdRoutes,
            otherHdRoutes: [...(this.simplificationConfig.otherHdRoutes ?? [])],
            netByConnectionName: this.simplificationConfig.netByConnectionName,
            obstacles: [...this.simplificationConfig.obstacles],
            colorMap: { ...this.simplificationConfig.colorMap },
            layerCount: this.simplificationConfig.layerCount,
            connMap: this.simplificationConfig.connMap,
            outline: this.simplificationConfig.outline
              ? [...this.simplificationConfig.outline]
              : undefined,
          })
          this.extractResult = (s) =>
            (s as SameNetViaMergerSolver).getMergedViaHdRoutes() ?? []
          break

        case "path_simplification":
          this.activeSubSolver = new MultiSimplifiedPathSolver({
            unsimplifiedHdRoutes: this.hdRoutes,
            otherHdRoutes: [...(this.simplificationConfig.otherHdRoutes ?? [])],
            obstacles: [...this.simplificationConfig.obstacles],
            connMap: this.simplificationConfig.connMap,
            colorMap: { ...this.simplificationConfig.colorMap },
            outline: this.simplificationConfig.outline
              ? [...this.simplificationConfig.outline]
              : undefined,
            defaultViaDiameter: this.simplificationConfig.defaultViaDiameter,
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

    // Draw immutable routed copper as subdued, dashed layer-colored peers.
    for (const route of this.simplificationConfig.otherHdRoutes ?? []) {
      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]
        const next = route.route[i + 1]
        if (current.z !== next.z) continue

        visualization.lines.push({
          points: [
            { x: current.x, y: current.y },
            { x: next.x, y: next.y },
          ],
          strokeColor:
            current.z === 0
              ? "rgba(160, 32, 32, 0.55)"
              : "rgba(32, 32, 160, 0.55)",
          strokeWidth: route.traceThickness,
          strokeDash: [0.08, 0.08],
          label: `${route.connectionName} immutable (z=${current.z})`,
        })
      }

      for (const via of route.vias) {
        visualization.circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(96, 96, 96, 0.45)",
          label: `${route.connectionName} immutable via`,
        })
      }
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
