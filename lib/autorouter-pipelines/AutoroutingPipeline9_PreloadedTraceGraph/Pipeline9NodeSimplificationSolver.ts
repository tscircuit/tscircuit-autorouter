import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type NodeSimplificationInput = {
  node: NodeWithPortPoints
  routes: HighDensityRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  clearance: number
  boardGeometry?: HighDensityBoardGeometry
}

// Force improvement uses vertices as control points, even on straight copper.
// Retain a control point at least every 0.25mm, plus all endpoint/via approaches.
const MAX_SIMPLIFIED_SEGMENT_LENGTH = 0.25

/** Removes redundant interior vertices without changing copper or via geometry. */
export class Pipeline9NodeSimplificationSolver extends BaseSolver {
  readonly routes: HighDensityRoute[]
  private routeIndex = 0

  constructor(readonly input: NodeSimplificationInput) {
    super()
    this.MAX_ITERATIONS = input.routes.length + 1
    this.routes = [...input.routes]
    this.stats = {
      inputPoints: this.routes.reduce((sum, r) => sum + r.route.length, 0),
      outputPoints: 0,
      obstacleCount: 0,
      routeCount: this.routes.length,
    }
  }

  override _step(): void {
    const original = this.routes[this.routeIndex]
    if (!original) {
      this.solved = true
      return
    }
    const points = original.route
    const protectedIndexes = new Set<number>([0, 1, points.length - 2, points.length - 1])
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!
      const isVia = original.vias.some((via) => via.x === point.x && via.y === point.y)
      const hasMetadata = Object.keys(point).some((key) => key !== "x" && key !== "y" && key !== "z")
      const changesLayer = i > 0 && points[i - 1]!.z !== point.z
      if (isVia || hasMetadata || changesLayer) {
        for (let offset = -2; offset <= 2; offset++) protectedIndexes.add(i + offset)
      }
    }
    const retainedIndexes: number[] = []
    const inset = this.input.clearance + original.traceThickness / 2
    const node = this.input.node
    for (let i = 0; i < points.length; i++) {
      const end = points[i]!
      while (retainedIndexes.length >= 2) {
        const middleIndex = retainedIndexes.at(-1)!
        const start = points[retainedIndexes.at(-2)!]!
        const middle = points[middleIndex]!
        if (protectedIndexes.has(middleIndex) || start.z !== middle.z || middle.z !== end.z) break
        if ([start, middle, end].some((point) =>
          Math.abs(point.x - node.center.x) > node.width / 2 - inset ||
          Math.abs(point.y - node.center.y) > node.height / 2 - inset,
        )) break
        const ax = middle.x - start.x
        const ay = middle.y - start.y
        const bx = end.x - middle.x
        const by = end.y - middle.y
        const length = Math.hypot(end.x - start.x, end.y - start.y)
        // Do not straighten corners or reverse a trace. Only roundoff on an
        // otherwise straight segment is tolerated (well below copper checks).
        if (length > MAX_SIMPLIFIED_SEGMENT_LENGTH || ax * bx + ay * by < 0 ||
          Math.abs(ax * by - ay * bx) > length * 1e-12) break
        retainedIndexes.pop()
      }
      retainedIndexes.push(i)
    }
    const route = retainedIndexes.map((index) => points[index]!)
    this.routes[this.routeIndex] = { ...original, route }
    this.stats.outputPoints += route.length
    this.routeIndex++
  }

  override visualize(): GraphicsObject {
    return {
      lines: this.routes.flatMap((route) => route.route.slice(1).flatMap((end, index) => {
        const start = route.route[index]!
        if (start.z !== end.z) return []
        return [{
          points: [start, end],
          strokeWidth: start.traceThickness ?? route.traceThickness,
          strokeColor: start.z === 0 ? "red" : "blue",
          strokeDash: start.z === 0 ? undefined : [0.1, 0.3],
          layer: `z${start.z}`,
          label: route.connectionName,
        }]
      })),
      circles: this.routes.flatMap((route) => route.vias.map((via) => ({
        center: via,
        radius: route.viaDiameter / 2,
        fill: "blue",
        label: route.connectionName,
      }))),
    }
  }

  override getConstructorParams(): [NodeSimplificationInput] {
    return [this.input]
  }

  override getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Node simplification is not complete")
    return this.routes
  }
}
