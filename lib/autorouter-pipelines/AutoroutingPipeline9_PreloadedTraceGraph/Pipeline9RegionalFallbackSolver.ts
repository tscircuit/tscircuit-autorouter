import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
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
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

type Pipeline9RegionalFallbackSolverParams = {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  connMap: ConnectivityMap
  viaDiameter: number
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
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  captureSearchDebug?: boolean
}

const getPointToObstacleDistance = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): number => {
  if (obstacle.shape === "circle") {
    return Math.max(
      0,
      Math.hypot(point.x - obstacle.center.x, point.y - obstacle.center.y) -
        obstacle.width / 2,
    )
  }
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
  private validatedRoutes?: HighDensityRoute[]

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
      growShrinkSolutionValidator: (routes): boolean =>
        this.validateCandidateWithCleanup(routes),
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

  private validateCandidateWithCleanup(routes: HighDensityRoute[]): boolean {
    const routedCandidate = materializePipeline9HdRouteVias(routes)
    if (!this.validateCandidateRoutes(routedCandidate)) return false

    // Cleanup is part of a candidate: a legal raw route can move into a pad.
    // Reject that candidate before the portfolio commits to its winner.
    const forceImproveSolver = new HighDensityForceImproveSolver({
      nodeWithPortPoints: [this.params.nodeWithPortPoints],
      hdRoutes: routedCandidate,
      colorMap: this.params.colorMap,
      totalStepsPerNode: Math.max(12, Math.round(20 * this.params.effort)),
      nodeAssignmentMargin: this.params.obstacleMargin,
    })
    forceImproveSolver.solve()
    if (forceImproveSolver.failed) {
      throw new Error(
        forceImproveSolver.error ?? "Regional force improvement failed",
      )
    }
    const forceImprovedRoutes = forceImproveSolver.getOutput()
    if (!this.validateCandidateRoutes(forceImprovedRoutes)) {
      this.stats.forceImproveCandidateRejectionCount =
        Number(this.stats.forceImproveCandidateRejectionCount ?? 0) + 1
      return false
    }
    const repairSolver = new Pipeline4HighDensityRepairSolver({
      nodeWithPortPoints: [this.params.nodeWithPortPoints],
      hdRoutes: forceImprovedRoutes,
      obstacles: this.params.obstacles,
      colorMap: this.params.colorMap,
      repairMargin: this.params.obstacleMargin,
      minimumTraceWidth: this.params.traceWidth,
      connMap: this.params.connMap,
    })
    repairSolver.solve()
    if (repairSolver.failed) {
      throw new Error(repairSolver.error ?? "Regional repair failed")
    }
    const repairedRoutes = repairSolver.getOutput()
    if (!this.validateCandidateRoutes(repairedRoutes)) {
      this.stats.repairCandidateRejectionCount =
        Number(this.stats.repairCandidateRejectionCount ?? 0) + 1
      return false
    }
    this.forceImproveSolver = forceImproveSolver
    this.repairSolver = repairSolver
    this.validatedRoutes = repairedRoutes
    return true
  }

  override _step(): void {
    this.highDensitySolver.step()
    if (this.highDensitySolver.failed) {
      this.error = this.highDensitySolver.error
      this.failed = true
      return
    }
    if (!this.highDensitySolver.solved) return
    if (!this.validatedRoutes) {
      throw new Error("Regional portfolio solved without a validated candidate")
    }
    this.activeSubSolver = null
    this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    if (this.validatedRoutes) return this.validatedRoutes
    return this.highDensitySolver.routes
  }

  override visualize(): GraphicsObject {
    return (
      this.repairSolver?.visualize() ??
      this.forceImproveSolver?.visualize() ??
      this.highDensitySolver.visualize()
    )
  }
}
