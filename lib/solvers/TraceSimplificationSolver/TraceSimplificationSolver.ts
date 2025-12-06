import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { GraphicsObject } from "graphics-debug"

type Phase = "via_removal" | "path_simplification"

/**
 * TraceSimplificationSolver consolidates trace optimization by iteratively applying
 * via removal and path simplification phases. It reduces redundant vias and simplifies
 * routing paths through configurable iterations.
 *
 * The solver operates in two alternating phases per iteration:
 * 1. "via_removal" - Removes unnecessary vias from routes using UselessViaRemovalSolver
 * 2. "path_simplification" - Simplifies routing paths using MultiSimplifiedPathSolver
 *
 * Each iteration consists of both phases executed sequentially. The default is 2 iterations,
 * meaning the solver runs via_removal → path_simplification → via_removal → path_simplification.
 */
export class TraceSimplificationSolver extends BaseSolver {
  /** The current state of high-density routes being progressively simplified */
  private hdRoutes: HighDensityRoute[] = []
  /** Current iteration count (0-indexed) */
  private currentRun = 0
  /** Total number of iterations to run (each iteration includes both phases) */
  private totalIterations: number
  /** Current phase of simplification being executed */
  private currentPhase: Phase = "via_removal"
  /** Callback to extract results from the active sub-solver */
  private extractResult: ((solver: BaseSolver) => HighDensityRoute[]) | null =
    null

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
      iterations?: number
    },
  ) {
    super()
    this.hdRoutes = [...simplificationConfig.hdRoutes]
    this.totalIterations = simplificationConfig.iterations ?? 2
    this.MAX_ITERATIONS = 100e6
  }

  _step() {
    if (this.currentRun >= this.totalIterations) {
      this.solved = true
      return
    }

    // If we have an active sub-solver, let it run
    if (this.activeSubSolver) {
      this.activeSubSolver.step()

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
          this.currentPhase = "path_simplification"
        } else {
          this.currentPhase = "via_removal"
          this.currentRun++
        }

        // Check if all iterations are complete
        if (this.currentRun >= this.totalIterations) {
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
      return
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
    if (!this.activeSubSolver)
      return { lines: [], points: [], rects: [], circles: [] } // Empty visualization if no routes
    return this.activeSubSolver.visualize()
  }
}
