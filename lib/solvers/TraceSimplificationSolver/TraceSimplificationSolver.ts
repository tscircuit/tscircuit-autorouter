import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import { GraphicsObject } from "graphics-debug"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"

type Phase = "via_removal" | "via_merging" | "path_simplification"

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
  hdRoutes: HighDensityRoute[] = []

  simplificationPipelineLoops = 0

  MAX_SIMPLIFICATION_PIPELINE_LOOPS: number = 2

  PHASE_ORDER: Phase[] = ["via_removal", "via_merging", "path_simplification"]

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
   *   - iterations: Number of complete simplification iterations (default: 2)
   */
  constructor(
    private simplificationConfig: {
      hdRoutes: HighDensityRoute[]
      obstacles: Obstacle[]
      connMap: ConnectivityMap
      colorMap: Record<string, string>
      outline?: Array<{ x: number; y: number }>
      defaultViaDiameter: number
      layerCount: number
    },
  ) {
    super()
    this.hdRoutes = [...simplificationConfig.hdRoutes]
    this.MAX_ITERATIONS = 100e6
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
          this.hdRoutes = this.extractResult(this.activeSubSolver)
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
            obstacles: this.simplificationConfig.obstacles,
            colorMap: this.simplificationConfig.colorMap,
            layerCount: this.simplificationConfig.layerCount,
          })
          this.extractResult = (s) =>
            (s as UselessViaRemovalSolver).getOptimizedHdRoutes() ?? []
          break

        case "via_merging":
          this.activeSubSolver = new SameNetViaMergerSolver({
            inputHdRoutes: this.hdRoutes,
            obstacles: this.simplificationConfig.obstacles,
            colorMap: this.simplificationConfig.colorMap,
            layerCount: this.simplificationConfig.layerCount,
            connMap: this.simplificationConfig.connMap,
            outline: this.simplificationConfig.outline,
          })
          this.extractResult = (s) =>
            (s as SameNetViaMergerSolver).getMergedViaHdRoutes() ?? []
          break

        case "path_simplification":
          this.activeSubSolver = new MultiSimplifiedPathSolver({
            unsimplifiedHdRoutes: this.hdRoutes,
            obstacles: this.simplificationConfig.obstacles,
            connMap: this.simplificationConfig.connMap,
            colorMap: this.simplificationConfig.colorMap,
            outline: this.simplificationConfig.outline,
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
      const isOnLayer0 = obstacle.zLayers?.includes(0)
      const isOnLayer1 = obstacle.zLayers?.includes(1)

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
        label: `Obstacle (Z: ${obstacle.zLayers?.join(", ")})`,
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
