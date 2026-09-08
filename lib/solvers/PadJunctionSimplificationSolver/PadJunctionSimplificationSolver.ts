/** Domain vocabulary shared by the search, output, and debugger.
 *
 * Anchor A --- first_trunk --- Junction --- second_trunk --- Anchor B
 *                                |
 *                             pad_stem
 *                                |
 *                               Pad
 *
 * The trunk consists of two arms; the pad stem joins them at the junction.
 *
 * Parsed input: validated geometry and normalized options used by the solver.
 * Junction path: an ordered sequence of routing points.
 * Candidate progress: the current arm stage plus only its completed arms.
 * Target pad: rectangular conductive area receiving both routes.
 * Branch anchor: fixed end of the same-layer terminal run being replaced.
 * Trunk: the connection between the two branch anchors, through the junction.
 * Junction: the single point where the pad stem joins the trunk.
 * Pad stem: the shared connection from the junction to the pad entry.
 * Pad entry: a point inside the pad, inset by half the trace width.
 * Candidate: a proposed trunk, junction, and pad stem.
 * Fixed copper: all route segments outside the two replaceable terminal runs.
 * Clearance: minimum edge-to-edge separation from unrelated copper.
 * Search state: grid position and incoming direction.
 * Search frontier: discovered states awaiting expansion in a priority queue.
 * Search cost: lexicographic pair (bend count, copper length).
 * Heuristic estimate: (zero bends, Euclidean distance to the goal).
 * Search budget: maximum expanded states for one pad-junction problem.
 * Accepted replacement: a fully checked candidate improving the original cost.
 *
 * Scope: two equal-width, same-layer terminal runs at an axis-aligned pad.
 * Pads with three or more discovered terminal branches are skipped.
 * Other layers and route metadata remain unchanged. Unsupported geometry is an
 * explicit no-op. A* finds shortest lexicographic paths on a bounded orthogonal
 * grid; sequential arm routing and first improvement do NOT guarantee a globally
 * optimal copper tree. Original endpoints are retained inside the conductive pad.
 */

import { getGraphicsLayerForObstacle } from "lib/utils/getGraphicsObjectLayer"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { SinglePadJunctionSolver } from "./SinglePadJunctionSolver"
import { getItemOrThrow, parsePadJunctionInput } from "./padJunctionGeometry"
import type { PadJunctionSimplificationInput, PadJunctionOutcome, AcceptedReplacement } from "./padJunctionGeometry"

export * from "./padJunctionGeometry"

/** Visits pads sequentially and applies each accepted two-branch replacement. */
export class PadJunctionSimplificationSolver extends BaseSolver {
  readonly outcomes: PadJunctionOutcome[] = []
  expandedStateCount = 0
  acceptedReplacement: AcceptedReplacement | null = null
  override activeSubSolver: SinglePadJunctionSolver | null = null
  private readonly output: HighDensityRoute[]
  private obstacleIndex = 0
  private readonly lockedRouteIndices = new Set<number>()
  private readonly parsed: ReturnType<typeof parsePadJunctionInput>

  constructor(private readonly input: PadJunctionSimplificationInput) {
    super()
    this.parsed = parsePadJunctionInput(input)
    this.output = this.parsed.hdRoutes.map(({ firstPoint, lastPoint, ...route }) => route)
    this.MAX_ITERATIONS = 100e6
  }

  override _step(): void {
    if (!this.activeSubSolver || this.activeSubSolver.solved) {
      if (this.obstacleIndex >= this.parsed.obstacles.length) {
        this.solved = true
        return
      }
      this.activeSubSolver = new SinglePadJunctionSolver({
        ...this.parsed, hdRoutes: this.output, targetPadIndex: this.obstacleIndex++,
        lockedRouteIndices: [...this.lockedRouteIndices],
      })
    }
    const solver = this.activeSubSolver
    const previousExpanded = solver.expandedStateCount
    solver.step()
    this.expandedStateCount += solver.expandedStateCount - previousExpanded
    this.stats = { ...solver.stats, expandedStates: this.expandedStateCount, padsVisited: this.obstacleIndex }
    if (solver.failed) throw new Error(`PadJunctionSimplificationSolver: child failed: ${solver.error}`)
    if (!solver.solved) return
    const result = solver.getOutput()
    this.outcomes.push(result.outcome)
    for (const { routeIndex, route } of result.replacements) {
      this.output[routeIndex] = route
      this.lockedRouteIndices.add(routeIndex)
    }
    if (solver.acceptedReplacement) this.acceptedReplacement = solver.acceptedReplacement
  }

  override getConstructorParams(): [PadJunctionSimplificationInput] {
    return [this.input]
  }

  override getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("PadJunctionSimplificationSolver: output requested before completion")
    return this.output
  }

  override visualize(): GraphicsObject {
    if (this.activeSubSolver) return this.activeSubSolver.visualize()
    return {
      title: "Pad junction simplification: ready",
      coordinateSystem: "cartesian",
      rects: this.parsed.obstacles.map((pad) => ({ center: pad.center, width: pad.width,
        height: pad.height, fill: "rgba(255,0,0,0.15)", label: "Obstacle",
        layer: getGraphicsLayerForObstacle(pad, this.parsed.layerCount) })),
      lines: this.output.flatMap((route) => route.route.slice(1).flatMap((end, index) => {
        const start = getItemOrThrow(route.route, index)
        if (start.z !== end.z) return []
        return [{ points: [start, end], strokeWidth: route.traceThickness,
          strokeColor: this.parsed.colorMap[route.connectionName] ?? "red",
          layer: `z${start.z}`, label: route.connectionName }]
      })),
    }
  }
}
