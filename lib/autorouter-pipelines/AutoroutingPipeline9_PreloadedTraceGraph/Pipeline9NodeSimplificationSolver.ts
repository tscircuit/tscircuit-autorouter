import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"
import { simplifyPipeline9CollinearRoutePoints } from "./simplifyPipeline9CollinearRoutePoints"

type NodeSimplificationInput = {
  node: NodeWithPortPoints
  routes: HighDensityRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  clearance: number
  boardGeometry?: HighDensityBoardGeometry
}

/** Runs the established pre-force grid reduction within one routing node. */
export class Pipeline9NodeSimplificationSolver extends BaseSolver {
  routes: HighDensityRoute[]

  constructor(readonly input: NodeSimplificationInput) {
    super()
    this.MAX_ITERATIONS = 2
    this.routes = [...input.routes]
    this.stats = {
      inputPoints: 0,
      outputPoints: 0,
      obstacleCount: 0,
      routeCount: this.routes.length,
    }
  }

  override _step(): void {
    // Use the same via representation and reduction policy as the existing
    // pre-force stage. Ordinary control points must remain available to repair.
    const canonicalRoutes = materializePipeline9HdRouteVias(this.input.routes)
    this.stats.inputPoints = canonicalRoutes.reduce(
      (sum, route) => sum + route.route.length,
      0,
    )
    this.routes = simplifyPipeline9CollinearRoutePoints(canonicalRoutes)
    this.stats.outputPoints = this.routes.reduce(
      (sum, route) => sum + route.route.length,
      0,
    )
    this.solved = true
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
