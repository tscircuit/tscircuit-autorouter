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
