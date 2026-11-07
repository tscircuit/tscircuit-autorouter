import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  NegotiateTraceClearanceSolver,
  getFixedObstacleViolations,
} from "@tscircuit/repair04"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

type Pipeline9RegionalFallbackSolverParams = {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  connMap: ConnectivityMap
  viaDiameter: number
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  boardGeometry?: HighDensityBoardGeometry
  traceWidth: number
  obstacleMargin: number
  effort: number
  nodePfById?:
    | Map<CapacityMeshNodeId, number | null>
    | Record<string, number | null>
  obstacles: Obstacle[]
  boardObstacles?: Obstacle[]
  movablePreloadedConnectionNames?: ReadonlySet<string>
  viaToPadClearance?: number
  traceToPadClearance?: number
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  captureSearchDebug?: boolean
}

type RegionalFallbackPhase =
  | "route"
  | "improve"
  | "repair"
  | "via-clearance"
  | "done"

const getPointToObstacleDistance = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): number => {
  const rotationRadians =
    (-1 * (obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const offsetX = point.x - obstacle.center.x
  const offsetY = point.y - obstacle.center.y
  const localX =
    offsetX * Math.cos(rotationRadians) - offsetY * Math.sin(rotationRadians)
  const localY =
    offsetX * Math.sin(rotationRadians) + offsetY * Math.cos(rotationRadians)
  const outsideX = Math.max(Math.abs(localX) - obstacle.width / 2, 0)
  const outsideY = Math.max(Math.abs(localY) - obstacle.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}

const getObstacleZLayers = (
  obstacle: Obstacle,
  layerCount: number,
): number[] => {
  const existingZLayers = obstacle.__zLayers ?? obstacle.zLayers
  if (existingZLayers) return existingZLayers

  return obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
}

export const isPipeline9ObstacleConnectedToRoute = ({
  obstacle,
  route,
  connMap,
}: {
  obstacle: Obstacle
  route: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">
  connMap: ConnectivityMap
}): boolean => {
  if (isObstacleConnectedToRoute(obstacle, route, connMap)) return true
  if (!route.rootConnectionName) return false

  const routeNetId =
    connMap.getNetConnectedToId(route.connectionName) ??
    connMap.getNetConnectedToId(route.rootConnectionName) ??
    (connMap.netMap[route.rootConnectionName]
      ? route.rootConnectionName
      : undefined)
  if (!routeNetId) return false

  return obstacle.connectedTo.some((connectedId) => {
    const connectedNetId =
      connMap.getNetConnectedToId(connectedId) ??
      (connMap.netMap[connectedId] ? connectedId : undefined)
    return connectedNetId === routeNetId
  })
}

const hasPreloadedViaToBoardObstacleConflict = ({
  routes,
  movablePreloadedConnectionNames,
  boardObstacles,
  connMap,
  layerCount,
  viaToPadClearance,
  allowBlindAndBuriedVias,
}: {
  routes: HighDensityRoute[]
  movablePreloadedConnectionNames: ReadonlySet<string>
  boardObstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  viaToPadClearance: number
  allowBlindAndBuriedVias?: boolean
}): boolean =>
  routes.some((route) => {
    if (!movablePreloadedConnectionNames.has(route.connectionName)) {
      return false
    }
    const viaSpans = getPipeline9RouteCopperGeometry(route, {
      layerCount,
      allowBlindAndBuriedVias,
    }).viaSpans
    return viaSpans.some((via) =>
      boardObstacles.some((obstacle) => {
        // Pours are regenerated with antipads around foreign through vias.
        // Keep their wire-layer obstacles, but do not treat them as solid pads.
        if (obstacle.isCopperPour) return false
        if (isPipeline9ObstacleConnectedToRoute({ obstacle, route, connMap }))
          return false
        const obstacleZLayers = getObstacleZLayers(obstacle, layerCount)
        if (!obstacleZLayers.some((z) => z >= via.minZ && z <= via.maxZ)) {
          return false
        }
        return (
          getPointToObstacleDistance(via.center, obstacle) <
          via.diameter / 2 + viaToPadClearance
        )
      }),
    )
  })

/** Runs the regular high-density cleanup pipeline for a B01 fallback region. */
export class Pipeline9RegionalFallbackSolver extends BaseSolver {
  readonly params: Pipeline9RegionalFallbackSolverParams
  readonly highDensitySolver: HighDensitySolver
  forceImproveSolver?: HighDensityForceImproveSolver
  repairSolver?: Pipeline4HighDensityRepairSolver
  viaClearanceSolver?: NegotiateTraceClearanceSolver
  private validatedRoutes?: HighDensityRoute[]
  private phase: RegionalFallbackPhase = "route"

  constructor(params: Pipeline9RegionalFallbackSolverParams) {
    super()
    this.params = params
    this.stats = {
      preloadedViaCandidateRejectionCount: 0,
      forceImproveCandidateRejectionCount: 0,
      repairCandidateRejectionCount: 0,
    }
    this.highDensitySolver = new HighDensitySolver({
      captureSearchDebug: params.captureSearchDebug,
      nodePortPoints: [params.nodeWithPortPoints],
      colorMap: params.colorMap,
      connMap: params.connMap,
      viaDiameter: params.viaDiameter,
      traceWidth: params.traceWidth,
      obstacleMargin: params.obstacleMargin,
      effort: params.effort,
      nodePfById: params.nodePfById,
      obstacles: params.obstacles,
      layerCount: params.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver: true,
      preserveTerminalPcbPortIds: false,
      growShrinkFallbackToInvalidGeometryOnFailure: false,
    })
    this.activeSubSolver = this.highDensitySolver
    this.MAX_ITERATIONS = 100e6 * params.effort
  }

  override getSolverName(): string {
    return "Pipeline9RegionalFallbackSolver"
  }

  private validateCandidateRoutes(routes: HighDensityRoute[]): boolean {
    const {
      boardObstacles,
      movablePreloadedConnectionNames,
      viaToPadClearance,
    } = this.params
    const pourObstacles = this.params.obstacles
      .filter((obstacle) => obstacle.isCopperPour)
      .map((obstacle) => ({
        ...obstacle,
        connectedTo: [
          ...obstacle.connectedTo,
          ...routes
            .filter((route) =>
              isPipeline9ObstacleConnectedToRoute({
                obstacle,
                route,
                connMap: this.params.connMap,
              }),
            )
            .map((route) => route.connectionName),
        ],
      }))
    if (pourObstacles.length > 0) {
      const node = this.params.nodeWithPortPoints
      const conflicts = getFixedObstacleViolations({
        srj: {
          bounds: {
            minX: node.center.x - node.width / 2,
            maxX: node.center.x + node.width / 2,
            minY: node.center.y - node.height / 2,
            maxY: node.center.y + node.height / 2,
          },
          layerCount: this.params.layerCount,
          minTraceWidth: this.params.traceWidth,
          obstacles: pourObstacles,
          connections: [],
        },
        routes,
        traceClearance:
          this.params.traceToPadClearance ?? this.params.obstacleMargin,
      })
      if (conflicts.some((conflict) => conflict.kind === "wire")) {
        this.stats.pourWireCandidateRejectionCount =
          Number(this.stats.pourWireCandidateRejectionCount ?? 0) + 1
        return false
      }
    }
    if (
      !boardObstacles ||
      !movablePreloadedConnectionNames ||
      viaToPadClearance === undefined
    ) {
      return true
    }
    const hasViaConflict = hasPreloadedViaToBoardObstacleConflict({
      routes,
      movablePreloadedConnectionNames,
      boardObstacles,
      connMap: this.params.connMap,
      layerCount: this.params.layerCount,
      allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
      viaToPadClearance,
    })
    if (hasViaConflict) {
      this.stats.preloadedViaCandidateRejectionCount =
        Number(this.stats.preloadedViaCandidateRejectionCount ?? 0) + 1
    }
    return !hasViaConflict
  }

  private startViaClearanceRepair(routes: HighDensityRoute[]): void {
    const { params } = this
    const node = params.nodeWithPortPoints
    const clearance = params.viaToPadClearance ?? params.obstacleMargin
    const collar = params.viaDiameter / 2 + clearance
    const board = params.boardGeometry?.bounds
    const bounds = {
      minX: Math.max(
        node.center.x - node.width / 2 - collar,
        board?.minX ?? -Infinity,
      ),
      maxX: Math.min(
        node.center.x + node.width / 2 + collar,
        board?.maxX ?? Infinity,
      ),
      minY: Math.max(
        node.center.y - node.height / 2 - collar,
        board?.minY ?? -Infinity,
      ),
      maxY: Math.min(
        node.center.y + node.height / 2 + collar,
        board?.maxY ?? Infinity,
      ),
    }
    const dirtyRouteIndices = routes.flatMap((route, index) =>
      this.validateCandidateRoutes([route]) ? [] : [index],
    )
    const srj: SimpleRouteJson = {
      ...params.boardGeometry,
      bounds,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      minViaDiameter: params.viaDiameter,
      minViaHoleDiameter: params.viaHoleDiameter,
      minViaHoleEdgeToViaHoleEdgeClearance:
        params.minViaHoleEdgeToViaHoleEdgeClearance,
      allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
      obstacles: params.obstacles.map((obstacle) => ({
        ...obstacle,
        connectedTo: [
          ...obstacle.connectedTo,
          ...routes
            .filter((route) =>
              isPipeline9ObstacleConnectedToRoute({
                obstacle,
                route,
                connMap: params.connMap,
              }),
            )
            .map((route) => route.connectionName),
        ],
      })),
      connections: routes.map((route) => ({
        name: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point) => ({
            x: point.x,
            y: point.y,
            layer: mapZToLayerName(point.z, params.layerCount),
          }),
        ),
      })),
    }
    this.viaClearanceSolver = new NegotiateTraceClearanceSolver({
      srj: { ...srj, traces: undefined },
      routes,
      bounds,
      dirtyRouteIndices,
      isLocked: (routeIndex, pointIndex): boolean =>
        pointIndex === 0 || pointIndex === routes[routeIndex]!.route.length - 1,
      allowLayerChanges: true,
      // The topology's planning margin can exceed the board's clearance rule.
      // Keep already legal regional endpoints available to clearance repair.
      traceClearance: params.traceToPadClearance ?? params.obstacleMargin,
      viaClearance: clearance,
      viaHoleDiameter: params.viaHoleDiameter,
      maxPathSearchNodes: Math.ceil(1_000_000 * params.effort),
      maxPathSearchNodesPerCall: 100_000,
      maxPathSearchCalls: Math.ceil(100 * params.effort),
      pathGridSizeScale: 1,
      pathHeuristicWeight: 3,
      searchDirectionCount: 2,
    })
    this.activeSubSolver = this.viaClearanceSolver
    this.phase = "via-clearance"
    this.MAX_ITERATIONS += this.viaClearanceSolver.MAX_ITERATIONS + 2
  }

  override _step(): void {
    if (this.phase === "route") {
      this.highDensitySolver.step()
      if (this.highDensitySolver.failed) {
        this.error = this.highDensitySolver.error
        this.failed = true
        return
      }
      if (!this.highDensitySolver.solved) return
      const routedCandidate = materializePipeline9HdRouteVias(
        this.highDensitySolver.routes,
      )
      // Grow/shrink produces provisional geometry. Keep it private until the
      // existing force-improve and obstacle-repair stages have placed its vias.
      this.forceImproveSolver = new HighDensityForceImproveSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        hdRoutes: routedCandidate,
        colorMap: this.params.colorMap,
        totalStepsPerNode: Math.max(12, Math.round(20 * this.params.effort)),
        nodeAssignmentMargin: this.params.obstacleMargin,
      })
      this.activeSubSolver = this.forceImproveSolver
      this.phase = "improve"
      return
    }

    if (this.phase === "improve") {
      this.forceImproveSolver!.step()
      if (this.forceImproveSolver!.failed) {
        this.error = this.forceImproveSolver!.error
        this.failed = true
        return
      }
      if (!this.forceImproveSolver!.solved) return
      const forceImprovedRoutes = this.forceImproveSolver!.getOutput()
      this.repairSolver = new Pipeline4HighDensityRepairSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        hdRoutes: forceImprovedRoutes,
        obstacles: this.params.obstacles,
        colorMap: this.params.colorMap,
        repairMargin: this.params.obstacleMargin,
        minimumTraceWidth: this.params.traceWidth,
        connMap: this.params.connMap,
      })
      this.activeSubSolver = this.repairSolver
      this.phase = "repair"
      return
    }

    if (this.phase === "repair") {
      this.repairSolver!.step()
      if (this.repairSolver!.failed) {
        this.error = this.repairSolver!.error
        this.failed = true
        return
      }
      if (!this.repairSolver!.solved) return
      const repairedRoutes = this.repairSolver!.getOutput()
      if (!this.validateCandidateRoutes(repairedRoutes)) {
        this.startViaClearanceRepair(repairedRoutes)
        return
      }
      this.validatedRoutes = repairedRoutes
      this.activeSubSolver = null
      this.phase = "done"
      this.solved = true
      return
    }

    if (this.phase === "via-clearance") {
      const solver = this.viaClearanceSolver!
      solver.step()
      this.stats.viaClearanceRepair = solver.stats
      if (solver.failed) {
        this.failed = true
        this.error = solver.error
        return
      }
      if (!solver.solved) return
      const routes = solver.getOutput().routes
      if (!this.validateCandidateRoutes(routes)) {
        this.stats.repairCandidateRejectionCount =
          Number(this.stats.repairCandidateRejectionCount ?? 0) + 1
        this.error =
          "Pipeline9 regional repair output failed its candidate validator"
        this.failed = true
        return
      }
      this.validatedRoutes = routes
      this.activeSubSolver = null
      this.phase = "done"
      this.solved = true
      return
    }
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || !this.validatedRoutes) {
      throw new Error("Cannot publish regional routes before final validation")
    }
    return this.validatedRoutes
  }

  override visualize(): GraphicsObject {
    return (
      this.repairSolver?.visualize() ??
      this.forceImproveSolver?.visualize() ??
      this.highDensitySolver.visualize()
    )
  }
}
