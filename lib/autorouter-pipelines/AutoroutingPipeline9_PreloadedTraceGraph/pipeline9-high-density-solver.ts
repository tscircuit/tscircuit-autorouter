import {
  defaultB01Params,
  HighDensitySolverB01,
  type HighDensityObstacle,
  type HighDensityRectObstacle,
  type HighDensityRouteObstacle,
  type NodeWithPortPoints as B01NodeWithPortPoints,
} from "@tscircuit/high-density-b01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BaseSolver } from "../../solvers/BaseSolver"
type Pipeline9HighDensitySolverParams = {
  nodePortPoints: NodeWithPortPoints[]
  fixedHdRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
  obstacles: Obstacle[]
  layerCount: number
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
  preserveTerminalPcbPortIds?: boolean
  includeBoardObstacles?: boolean
  maxB01Rips?: number
}

type NodeBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const PRELOADED_TRACE_CLEARANCE = 0.15

const getNodeBounds = (
  node: NodeWithPortPoints,
  margin: number,
): NodeBounds => ({
  minX: node.center.x - node.width / 2 - margin,
  maxX: node.center.x + node.width / 2 + margin,
  minY: node.center.y - node.height / 2 - margin,
  maxY: node.center.y + node.height / 2 + margin,
})

const routeOverlapsNode = (
  route: HighDensityRoute,
  nodeBounds: NodeBounds,
): boolean => {
  const routePoints = [...route.route, ...route.vias.map((via) => ({ ...via }))]
  if (routePoints.length === 0) return false

  const minX = Math.min(...routePoints.map((point) => point.x))
  const maxX = Math.max(...routePoints.map((point) => point.x))
  const minY = Math.min(...routePoints.map((point) => point.y))
  const maxY = Math.max(...routePoints.map((point) => point.y))
  const routeMargin = Math.max(route.traceThickness / 2, route.viaDiameter / 2)

  return (
    minX - routeMargin <= nodeBounds.maxX &&
    maxX + routeMargin >= nodeBounds.minX &&
    minY - routeMargin <= nodeBounds.maxY &&
    maxY + routeMargin >= nodeBounds.minY
  )
}

const convertFixedRouteToB01Obstacle = (
  route: HighDensityRoute,
  node: NodeWithPortPoints,
): HighDensityRouteObstacle | undefined => {
  const availableZ = new Set(
    node.availableZ ?? node.portPoints.map((portPoint) => portPoint.z),
  )
  if (availableZ.size === 0) {
    throw new Error(
      `Pipeline9 B01 node "${node.capacityMeshNodeId}" has no available layers`,
    )
  }

  if (!route.route.every((point) => availableZ.has(point.z))) {
    return undefined
  }

  return {
    type: "route",
    connectionName: route.connectionName,
    rootConnectionName: route.rootConnectionName,
    traceThickness: route.traceThickness,
    viaDiameter: route.viaDiameter,
    route: route.route,
    vias: [],
  }
}

const obstacleOverlapsNode = (
  obstacle: Obstacle,
  nodeBounds: NodeBounds,
): boolean =>
  obstacle.center.x - obstacle.width / 2 <= nodeBounds.maxX &&
  obstacle.center.x + obstacle.width / 2 >= nodeBounds.minX &&
  obstacle.center.y - obstacle.height / 2 <= nodeBounds.maxY &&
  obstacle.center.y + obstacle.height / 2 >= nodeBounds.minY

const convertObstacleToB01Obstacle = ({
  obstacle,
  node,
  connMap,
  layerCount,
}: {
  obstacle: Obstacle
  node: NodeWithPortPoints
  connMap: ConnectivityMap
  layerCount: number
}): HighDensityRectObstacle | undefined => {
  const availableZ = new Set(
    node.availableZ ?? node.portPoints.map((portPoint) => portPoint.z),
  )
  const zLayers = (
    obstacle.zLayers ??
    obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
  ).filter((z) => availableZ.has(z))
  if (zLayers.length === 0) return undefined
  const connectionName =
    obstacle.connectedTo[0] ??
    obstacle.obstacleId ??
    `pipeline9_obstacle_${obstacle.center.x}_${obstacle.center.y}`
  return {
    type: "rect",
    connectionName,
    rootConnectionName:
      connMap.getNetConnectedToId(connectionName) ?? connectionName,
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    ccwRotationDegrees: obstacle.ccwRotationDegrees,
    zLayers,
  }
}

const addTerminalPcbPortIds = (
  routes: HighDensityIntraNodeRoute[],
  node: NodeWithPortPoints,
): HighDensityIntraNodeRoute[] => {
  const terminalPortPoints = node.portPoints.filter(
    (portPoint) => portPoint.pcb_port_id !== undefined,
  )
  return routes.map((route) => {
    const start = route.route[0]
    const end = route.route.at(-1)
    const startTerminal = terminalPortPoints.find(
      (terminal) =>
        start !== undefined &&
        terminal.connectionName === route.connectionName &&
        terminal.x === start.x &&
        terminal.y === start.y &&
        terminal.z === start.z,
    )
    const endTerminal = terminalPortPoints.find(
      (terminal) =>
        end !== undefined &&
        terminal.connectionName === route.connectionName &&
        terminal.x === end.x &&
        terminal.y === end.y &&
        terminal.z === end.z,
    )

    return {
      ...route,
      startPcbPortId: startTerminal?.pcb_port_id,
      endPcbPortId: endTerminal?.pcb_port_id,
    }
  })
}

const normalizeNodeRootConnectionNames = (
  node: NodeWithPortPoints,
  connMap: ConnectivityMap,
): NodeWithPortPoints => {
  const normalizePortPoint = (
    portPoint: NodeWithPortPoints["portPoints"][number],
  ): NodeWithPortPoints["portPoints"][number] => ({
    ...portPoint,
    rootConnectionName:
      connMap.getNetConnectedToId(
        portPoint.rootConnectionName ?? portPoint.connectionName,
      ) ??
      portPoint.rootConnectionName ??
      portPoint.connectionName,
  })
  return {
    ...node,
    portPoints: node.portPoints.map(normalizePortPoint),
    portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
      normalizePortPoint(start),
      normalizePortPoint(end),
    ]),
  }
}

const restoreRootConnectionNames = (
  routes: HighDensityIntraNodeRoute[],
  node: NodeWithPortPoints,
): HighDensityIntraNodeRoute[] =>
  routes.map((route) => ({
    ...route,
    rootConnectionName:
      node.portPoints.find(
        (portPoint) => portPoint.connectionName === route.connectionName,
      )?.rootConnectionName ?? route.rootConnectionName,
  }))

/**
 * Routes Pipeline9 intra-node connections with B01 while treating preloaded
 * copper as immutable, layer-aware route obstacles.
 */
export class Pipeline9HighDensitySolver extends BaseSolver {
  readonly fixedHdRoutes: HighDensityRoute[]
  readonly connMap: ConnectivityMap
  readonly obstacles: Obstacle[]
  readonly layerCount: number
  readonly viaDiameter: number
  readonly traceWidth: number
  readonly obstacleMargin: number
  readonly effort: number
  readonly preserveTerminalPcbPortIds: boolean
  readonly includeBoardObstacles: boolean
  readonly maxB01Rips?: number
  readonly routes: HighDensityIntraNodeRoute[] = []
  readonly failedSolvers: HighDensitySolverB01[] = []
  readonly unsolvedNodePortPoints: NodeWithPortPoints[]

  activeB01Solver: HighDensitySolverB01 | null = null
  activeNode: NodeWithPortPoints | null = null

  constructor(params: Pipeline9HighDensitySolverParams) {
    super()
    this.fixedHdRoutes = params.fixedHdRoutes
    this.connMap = params.connMap
    this.obstacles = params.obstacles
    this.layerCount = params.layerCount
    this.viaDiameter = params.viaDiameter
    this.traceWidth = params.traceWidth
    this.obstacleMargin = params.obstacleMargin
    this.effort = params.effort
    this.preserveTerminalPcbPortIds = params.preserveTerminalPcbPortIds ?? false
    this.includeBoardObstacles = params.includeBoardObstacles ?? false
    this.maxB01Rips = params.maxB01Rips
    this.unsolvedNodePortPoints = [...params.nodePortPoints]
    this.MAX_ITERATIONS = 100e6 * this.effort
    this.stats = {
      nodeCount: params.nodePortPoints.length,
      solvedNodeCount: 0,
      fixedObstacleCount: params.fixedHdRoutes.length,
      fixedObstacleUses: 0,
      boardObstacleUses: 0,
    }
  }

  override getSolverName(): string {
    return "Pipeline9HighDensitySolver"
  }

  private finishActiveNode(routes: HighDensityIntraNodeRoute[]) {
    const solvedRoutes = this.activeNode
      ? restoreRootConnectionNames(routes, this.activeNode)
      : routes
    this.routes.push(
      ...(this.preserveTerminalPcbPortIds && this.activeNode
        ? addTerminalPcbPortIds(solvedRoutes, this.activeNode)
        : solvedRoutes),
    )
    this.stats.solvedNodeCount = Number(this.stats.solvedNodeCount ?? 0) + 1
    this.activeB01Solver = null
    this.activeNode = null
  }

  override _step(): void {
    if (this.activeB01Solver) {
      this.activeB01Solver.step()
      if (this.activeB01Solver.failed) {
        this.failedSolvers.push(this.activeB01Solver)
        this.error = `Pipeline9 B01 failed: ${this.activeB01Solver.error ?? "unknown error"}`
        this.failed = true
        this.activeB01Solver = null
        this.activeNode = null
        return
      }
      if (!this.activeB01Solver.solved) return

      this.finishActiveNode(this.activeB01Solver.getOutput())
      return
    }

    const node = this.unsolvedNodePortPoints.pop()
    if (!node) {
      this.solved = true
      return
    }
    if (node.width > 15 || node.height > 15) {
      this.error = `Pipeline9 B01 node "${node.capacityMeshNodeId}" exceeds the 15x15mm routing limit (${node.width}x${node.height}mm)`
      this.failed = true
      return
    }

    const nodeBounds = getNodeBounds(node, this.obstacleMargin)
    const fixedObstacles = this.fixedHdRoutes
      .filter((route) => routeOverlapsNode(route, nodeBounds))
      .map((route) => convertFixedRouteToB01Obstacle(route, node))
      .filter(
        (obstacle): obstacle is HighDensityRouteObstacle =>
          obstacle !== undefined,
      )
    const boardObstacles = (this.includeBoardObstacles ? this.obstacles : [])
      .filter((obstacle) => obstacleOverlapsNode(obstacle, nodeBounds))
      .map((obstacle) =>
        convertObstacleToB01Obstacle({
          obstacle,
          node,
          connMap: this.connMap,
          layerCount: this.layerCount,
        }),
      )
      .filter(
        (obstacle): obstacle is HighDensityRectObstacle =>
          obstacle !== undefined,
      )
    this.stats.fixedObstacleUses =
      Number(this.stats.fixedObstacleUses ?? 0) + fixedObstacles.length
    this.stats.boardObstacleUses =
      Number(this.stats.boardObstacleUses ?? 0) + boardObstacles.length
    this.activeNode = node
    const normalizedNode = normalizeNodeRootConnectionNames(node, this.connMap)
    this.activeB01Solver = new HighDensitySolverB01({
      ...defaultB01Params,
      nodeWithPortPoints: normalizedNode as B01NodeWithPortPoints,
      obstacles: [
        ...fixedObstacles,
        ...boardObstacles,
      ] as HighDensityObstacle[],
      viaDiameter: this.viaDiameter,
      viaMinDistFromBorder: this.viaDiameter / 2,
      traceThickness: this.traceWidth,
      traceMargin: this.obstacleMargin,
      obstacleClearanceMargin: PRELOADED_TRACE_CLEARANCE,
      effort: this.effort,
    })
    if (this.maxB01Rips !== undefined) {
      this.activeB01Solver.MAX_RIPS = this.maxB01Rips
    }
  }

  override visualize(): GraphicsObject {
    return (
      this.activeB01Solver?.visualize() ?? {
        lines: this.routes.flatMap((route) =>
          route.route.slice(0, -1).map((point, pointIndex) => ({
            points: [point, route.route[pointIndex + 1]!],
            strokeWidth: route.traceThickness,
            layer: `z${point.z}`,
            label: route.connectionName,
          })),
        ),
        points: [],
        rects: [],
        circles: [],
      }
    )
  }
}
