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
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"
import {
  createRegionalFallbackProblem,
  type FixedRouteSection,
  spliceFixedRouteSection,
} from "./pipeline9-regional-fallback"
import { Pipeline9RegionalFallbackSolver } from "./pipeline9-regional-fallback-solver"

type Pipeline9HighDensitySolverParams = {
  nodePortPoints: NodeWithPortPoints[]
  fixedHdRoutes: PreloadedHighDensityRoute[]
  connMap: ConnectivityMap
  colorMap?: Record<string, string>
  obstacles: Obstacle[]
  layerCount: number
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
  preserveTerminalPcbPortIds?: boolean
  includeBoardObstacles?: boolean
  enableRegionalFallback?: boolean
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
  const routeMargin = Math.max(route.traceThickness / 2, route.viaDiameter / 2)
  const geometryOverlapsNode = (
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) =>
    Math.min(start.x, end.x) - routeMargin <= nodeBounds.maxX &&
    Math.max(start.x, end.x) + routeMargin >= nodeBounds.minX &&
    Math.min(start.y, end.y) - routeMargin <= nodeBounds.maxY &&
    Math.max(start.y, end.y) + routeMargin >= nodeBounds.minY

  return (
    route.route.some((point, pointIndex) => {
      const nextPoint = route.route[pointIndex + 1]
      return nextPoint
        ? geometryOverlapsNode(point, nextPoint)
        : route.route.length === 1 && geometryOverlapsNode(point, point)
    }) ||
    route.vias.some((via) => geometryOverlapsNode(via, via))
  )
}

const clipSegmentToBounds = ({
  start,
  end,
  bounds,
}: {
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
  bounds: NodeBounds
}): [HighDensityRoute["route"][number], HighDensityRoute["route"][number]] | undefined => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let entry = 0
  let exit = 1
  const boundaries = [
    [-dx, start.x - bounds.minX],
    [dx, bounds.maxX - start.x],
    [-dy, start.y - bounds.minY],
    [dy, bounds.maxY - start.y],
  ] as const

  for (const [direction, distance] of boundaries) {
    if (direction === 0) {
      if (distance < 0) return undefined
      continue
    }
    const ratio = distance / direction
    if (direction < 0) entry = Math.max(entry, ratio)
    else exit = Math.min(exit, ratio)
    if (entry > exit) return undefined
  }

  const interpolate = (amount: number) => ({
    ...start,
    x: start.x + dx * amount,
    y: start.y + dy * amount,
  })
  return [interpolate(entry), { ...interpolate(exit), z: end.z }]
}

const convertFixedRouteToB01Obstacles = (
  route: PreloadedHighDensityRoute,
  node: NodeWithPortPoints,
  obstacleMargin: number,
): HighDensityRouteObstacle[] => {
  const availableZ = new Set(
    node.availableZ ?? node.portPoints.map((portPoint) => portPoint.z),
  )
  if (availableZ.size === 0) {
    throw new Error(
      `Pipeline9 B01 node "${node.capacityMeshNodeId}" has no available layers`,
    )
  }

  const routeMargin = Math.max(route.traceThickness / 2, route.viaDiameter / 2)
  const clipBounds = {
    minX: node.center.x - node.width / 2 - routeMargin - obstacleMargin,
    maxX: node.center.x + node.width / 2 + routeMargin + obstacleMargin,
    minY: node.center.y - node.height / 2 - routeMargin - obstacleMargin,
    maxY: node.center.y + node.height / 2 + routeMargin + obstacleMargin,
  }
  const obstacles: HighDensityRouteObstacle[] = []
  for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
    const start = route.route[pointIndex - 1]!
    const end = route.route[pointIndex]!
    if (!availableZ.has(start.z) || !availableZ.has(end.z)) continue
    const clippedRoute =
      start.z === end.z
        ? clipSegmentToBounds({ start, end, bounds: clipBounds })
        : start.x >= clipBounds.minX &&
            start.x <= clipBounds.maxX &&
            start.y >= clipBounds.minY &&
            start.y <= clipBounds.maxY
          ? ([start, end] as const)
          : undefined
    if (!clippedRoute) continue
    obstacles.push({
      type: "route",
      connectionName: route.connectionName,
      rootConnectionName: route.rootConnectionName,
      traceThickness: route.traceThickness,
      viaDiameter: route.viaDiameter,
      route: [...clippedRoute],
      vias: [],
    })
  }
  return obstacles
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
  readonly fixedHdRoutes: PreloadedHighDensityRoute[]
  readonly connMap: ConnectivityMap
  readonly colorMap: Record<string, string>
  readonly obstacles: Obstacle[]
  readonly layerCount: number
  readonly viaDiameter: number
  readonly traceWidth: number
  readonly obstacleMargin: number
  readonly effort: number
  readonly preserveTerminalPcbPortIds: boolean
  readonly includeBoardObstacles: boolean
  readonly enableRegionalFallback: boolean
  readonly maxB01Rips?: number
  readonly routes: HighDensityIntraNodeRoute[] = []
  readonly failedSolvers: HighDensitySolverB01[] = []
  readonly unsolvedNodePortPoints: NodeWithPortPoints[]
  readonly fixedRouteReplacements = new Map<string, PreloadedHighDensityRoute>()
  readonly removedFixedRouteConnectionNames = new Set<string>()

  activeB01Solver: HighDensitySolverB01 | null = null
  activeFallbackSolver: Pipeline9RegionalFallbackSolver | null = null
  activeFallbackFixedRouteSections = new Map<string, FixedRouteSection>()
  activeB01Error: string | null = null
  activeNode: NodeWithPortPoints | null = null

  constructor(params: Pipeline9HighDensitySolverParams) {
    super()
    this.fixedHdRoutes = params.fixedHdRoutes
    this.connMap = params.connMap
    this.colorMap = params.colorMap ?? {}
    this.obstacles = params.obstacles
    this.layerCount = params.layerCount
    this.viaDiameter = params.viaDiameter
    this.traceWidth = params.traceWidth
    this.obstacleMargin = params.obstacleMargin
    this.effort = params.effort
    this.preserveTerminalPcbPortIds = params.preserveTerminalPcbPortIds ?? false
    this.includeBoardObstacles = params.includeBoardObstacles ?? false
    this.enableRegionalFallback = params.enableRegionalFallback ?? true
    this.maxB01Rips = params.maxB01Rips
    this.unsolvedNodePortPoints = [...params.nodePortPoints]
    this.MAX_ITERATIONS = 100e6 * this.effort
    this.stats = {
      nodeCount: params.nodePortPoints.length,
      solvedNodeCount: 0,
      fixedObstacleCount: params.fixedHdRoutes.length,
      fixedObstacleUses: 0,
      boardObstacleUses: 0,
      fallbackNodeCount: 0,
      reroutedFixedRouteCount: 0,
      reroutedFixedRouteSectionCount: 0,
    }
  }

  override getSolverName(): string {
    return "Pipeline9HighDensitySolver"
  }

  getUpdatedFixedHdRoutes(): PreloadedHighDensityRoute[] {
    return this.fixedHdRoutes.flatMap((route) => {
      if (this.removedFixedRouteConnectionNames.has(route.connectionName)) {
        return []
      }
      return [this.fixedRouteReplacements.get(route.connectionName) ?? route]
    })
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
    this.activeFallbackSolver = null
    this.activeFallbackFixedRouteSections.clear()
    this.activeB01Error = null
    this.activeNode = null
  }

  private startRegionalFallback() {
    if (!this.activeNode) {
      throw new Error(
        "Pipeline9 cannot start a regional fallback without an active node",
      )
    }

    const normalizedNode = normalizeNodeRootConnectionNames(
      this.activeNode,
      this.connMap,
    )
    const fallbackProblem = createRegionalFallbackProblem(
      normalizedNode,
      this.getUpdatedFixedHdRoutes(),
    )
    this.activeFallbackFixedRouteSections =
      fallbackProblem.fixedRouteSectionsByConnectionName
    this.activeFallbackSolver = new Pipeline9RegionalFallbackSolver({
      nodeWithPortPoints: fallbackProblem.nodeWithPortPoints,
      colorMap: this.colorMap,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
      obstacles: this.obstacles,
      layerCount: this.layerCount,
    })
    this.stats.fallbackNodeCount = Number(this.stats.fallbackNodeCount ?? 0) + 1
  }

  private finishRegionalFallback() {
    if (!this.activeFallbackSolver) return

    const newRoutes: HighDensityIntraNodeRoute[] = []
    const replacementRoutesByConnectionName = new Map<
      string,
      HighDensityRoute[]
    >()

    for (const route of this.activeFallbackSolver.getOutput()) {
      if (!this.activeFallbackFixedRouteSections.has(route.connectionName)) {
        newRoutes.push(route)
        continue
      }
      const replacementRoutes =
        replacementRoutesByConnectionName.get(route.connectionName) ?? []
      replacementRoutes.push(route)
      replacementRoutesByConnectionName.set(
        route.connectionName,
        replacementRoutes,
      )
    }

    for (const [connectionName, section] of this
      .activeFallbackFixedRouteSections) {
      const replacementRoutes =
        replacementRoutesByConnectionName.get(connectionName) ?? []
      if (replacementRoutes.length !== 1) {
        this.error = `Pipeline9 regional fallback expected one replacement for fixed route "${connectionName}", got ${replacementRoutes.length}`
        this.failed = true
        return
      }
      this.fixedRouteReplacements.set(
        connectionName,
        spliceFixedRouteSection(section, replacementRoutes[0]!),
      )
      for (const sourceRoute of section.sourceRoutes.slice(1)) {
        this.removedFixedRouteConnectionNames.add(sourceRoute.connectionName)
      }
    }

    const reroutedFixedRouteCount = [
      ...this.activeFallbackFixedRouteSections.values(),
    ].reduce((count, section) => count + section.sourceRoutes.length, 0)
    this.stats.reroutedFixedRouteCount =
      Number(this.stats.reroutedFixedRouteCount ?? 0) + reroutedFixedRouteCount
    this.stats.reroutedFixedRouteSectionCount =
      Number(this.stats.reroutedFixedRouteSectionCount ?? 0) +
      this.activeFallbackFixedRouteSections.size
    this.finishActiveNode(newRoutes)
  }

  override _step(): void {
    if (this.activeFallbackSolver) {
      this.activeFallbackSolver.step()
      if (this.activeFallbackSolver.failed) {
        this.error = [
          `Pipeline9 B01 failed: ${this.activeB01Error ?? "unknown error"}`,
          `regional fallback failed: ${this.activeFallbackSolver.error ?? "unknown error"}`,
        ].join("; ")
        this.failed = true
        this.activeFallbackSolver = null
        this.activeFallbackFixedRouteSections.clear()
        this.activeNode = null
        return
      }
      if (!this.activeFallbackSolver.solved) return

      this.finishRegionalFallback()
      return
    }

    if (this.activeB01Solver) {
      this.activeB01Solver.step()
      if (this.activeB01Solver.failed) {
        this.failedSolvers.push(this.activeB01Solver)
        this.activeB01Error = this.activeB01Solver.error
        this.activeB01Solver = null
        if (!this.enableRegionalFallback) {
          this.error = `Pipeline9 B01 failed: ${this.activeB01Error ?? "unknown error"}`
          this.failed = true
          this.activeNode = null
          return
        }
        this.startRegionalFallback()
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
    const fixedObstacles = this.getUpdatedFixedHdRoutes()
      .filter((route) => routeOverlapsNode(route, nodeBounds))
      .flatMap((route) =>
        convertFixedRouteToB01Obstacles(route, node, this.obstacleMargin),
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
      this.activeFallbackSolver?.visualize() ??
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
