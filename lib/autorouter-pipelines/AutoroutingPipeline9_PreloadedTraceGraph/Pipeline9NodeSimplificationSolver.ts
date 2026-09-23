import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import { VertexShortcutPathSolver } from "@tscircuit/trace-simplification-solver"
import type { GraphicsObject } from "graphics-debug"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"
import { arePipeline9RoutesOnSameNet, doPipeline9RoutesHaveCopperConflict } from "./pipeline9FixedRouteCopper"

type NodeSimplificationInput = {
  node: NodeWithPortPoints
  routes: HighDensityRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  clearance: number
  boardGeometry?: HighDensityBoardGeometry
}

type Point = HighDensityRoute["route"][number]

class NodeVertexShortcutSolver extends VertexShortcutPathSolver {
  constructor(
    params: ConstructorParameters<typeof VertexShortcutPathSolver>[0],
    readonly context: NodeSimplificationInput,
  ) {
    super(params)
  }

  override isValidPath(points: Point[]): boolean {
    const { node, clearance, connMap } = this.context
    // Leave boundary copper untouched: independently solved neighbors cannot
    // participate in this index. Grown-node overlaps still need global repair.
    const inset = clearance + this.inputRoute.traceThickness / 2
    if (points.some((p) =>
      Math.abs(p.x - node.center.x) > node.width / 2 - inset ||
      Math.abs(p.y - node.center.y) > node.height / 2 - inset,
    )) return false
    if (!super.isValidPath(points)) return false
    const candidate = { ...this.inputRoute, route: points, vias: [] }
    for (const other of this.otherHdRoutes) {
      if (arePipeline9RoutesOnSameNet(candidate, other, connMap)) continue
      if (doPipeline9RoutesHaveCopperConflict({ left: candidate, right: other, clearance })) return false
    }
    // The upstream shortcut index uses a 0.1mm margin. Check the configured
    // margin as well, including rotated pads, against this node's local list.
    for (const obstacle of this.context.obstacles) {
      const routeName = this.inputRoute.rootConnectionName ?? this.inputRoute.connectionName
      if (obstacle.connectedTo.some((id) => id === routeName || connMap.areIdsConnected(id, routeName))) continue
      const zLayers = obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, this.context.layerCount))
      if (!zLayers.includes(points[0]!.z)) continue
      const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const local = points.map((p) => ({
        x: (p.x - obstacle.center.x) * cos - (p.y - obstacle.center.y) * sin,
        y: (p.x - obstacle.center.x) * sin + (p.y - obstacle.center.y) * cos,
      }))
      for (let i = 1; i < local.length; i++) {
        if (segmentToBoxMinDistance(local[i - 1]!, local[i]!, {
          center: { x: 0, y: 0 }, width: obstacle.width, height: obstacle.height,
        }) < inset) return false
      }
    }
    return true
  }
}

/** One shortcut pass over one node; endpoints, vias and boundary copper stay fixed. */
export class Pipeline9NodeSimplificationSolver extends BaseSolver {
  readonly routes: HighDensityRoute[]
  readonly localObstacles: Obstacle[]
  private routeIndex = 0
  private shortcutSolver: NodeVertexShortcutSolver | null = null

  constructor(readonly input: NodeSimplificationInput) {
    super()
    this.MAX_ITERATIONS = 100e6
    this.routes = materializePipeline9HdRouteVias(input.routes)
    const margin = input.clearance + Math.max(0, ...input.routes.map((r) => r.traceThickness / 2))
    this.localObstacles = input.obstacles.filter((obstacle) => {
      // A circumscribed radius includes rotated and unrotated obstacle models.
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2 + margin
      return Math.abs(obstacle.center.x - input.node.center.x) <= input.node.width / 2 + radius &&
        Math.abs(obstacle.center.y - input.node.center.y) <= input.node.height / 2 + radius
    })
    this.stats = {
      inputPoints: this.routes.reduce((sum, r) => sum + r.route.length, 0),
      outputPoints: 0,
      obstacleCount: this.localObstacles.length,
      routeCount: this.routes.length,
    }
  }

  override _step(): void {
    if (this.shortcutSolver) {
      this.shortcutSolver.step()
      if (this.shortcutSolver.failed) throw new Error(this.shortcutSolver.error ?? "Node shortcut failed")
      if (!this.shortcutSolver.solved) return
      const original = this.routes[this.routeIndex]!
      this.routes[this.routeIndex] = { ...original, route: this.shortcutSolver.newRoute }
      this.stats.outputPoints += this.shortcutSolver.newRoute.length
      this.routeIndex++
      this.shortcutSolver = null
      this.activeSubSolver = null
      return
    }
    const route = this.routes[this.routeIndex]
    if (!route) {
      this.solved = true
      return
    }
    this.shortcutSolver = new NodeVertexShortcutSolver({
      inputRoute: route,
      otherHdRoutes: this.routes.filter((_, index) => index !== this.routeIndex),
      obstacles: this.localObstacles.map((obstacle) => ({
        ...obstacle,
        __zLayers: obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, this.input.layerCount)),
      })),
      connMap: this.input.connMap,
      colorMap: {},
      outline: this.input.boardGeometry?.outline,
      minBoardEdgeClearance: this.input.boardGeometry?.minBoardEdgeClearance,
      useTraceWidthAwareClearance: true,
    }, { ...this.input, obstacles: this.localObstacles })
    // VertexShortcutPathSolver advances at least one source vertex per step.
    // Its inherited 1,000-step cap is too small for dense grid routes.
    this.shortcutSolver.MAX_ITERATIONS = route.route.length + 1
    this.activeSubSolver = this.shortcutSolver as unknown as BaseSolver
  }

  override visualize(): GraphicsObject {
    if (this.shortcutSolver) return this.shortcutSolver.visualize()
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
