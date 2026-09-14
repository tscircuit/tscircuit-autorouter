import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { applyViaToPadClearanceRelaxation } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"
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
}

type RegionalFallbackPhase = "route" | "improve" | "repair" | "done"

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

const getPreloadedViaToBoardObstacleConflictCount = ({
  routes,
  movablePreloadedConnectionNames,
  boardObstacles,
  connMap,
  layerCount,
  viaToPadClearance,
}: {
  routes: HighDensityRoute[]
  movablePreloadedConnectionNames: ReadonlySet<string>
  boardObstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  viaToPadClearance: number
}): number => {
  let conflictCount = 0
  for (const route of routes) {
    if (!movablePreloadedConnectionNames.has(route.connectionName)) {
      continue
    }
    const viaSpans = getPipeline9RouteCopperGeometry(route).viaSpans
    for (const via of viaSpans) {
      for (const obstacle of boardObstacles) {
        if (isObstacleConnectedToRoute(obstacle, route, connMap)) continue
        const obstacleZLayers = getObstacleZLayers(obstacle, layerCount)
        if (!obstacleZLayers.some((z) => z >= via.minZ && z <= via.maxZ)) {
          continue
        }
        if (
          getPointToObstacleDistance(via.center, obstacle) <
          via.diameter / 2 + viaToPadClearance
        ) {
          conflictCount++
        }
      }
    }
  }
  return conflictCount
}

/** Runs the regular high-density cleanup pipeline for a B01 fallback region. */
export class Pipeline9RegionalFallbackSolver extends BaseSolver {
  readonly params: Pipeline9RegionalFallbackSolverParams
  readonly highDensitySolver: HighDensitySolver
  forceImproveSolver?: HighDensityForceImproveSolver
  repairSolver?: Pipeline4HighDensityRepairSolver
  private acceptedRoutes?: HighDensityRoute[]
  private phase: RegionalFallbackPhase = "route"

  constructor(params: Pipeline9RegionalFallbackSolverParams) {
    super()
    this.params = params
    this.stats = {
      invalidLayerTransitionCandidateRejectionCount: 0,
      preloadedViaCandidateRejectionCount: 0,
      forceImproveCandidateRejectionCount: 0,
      repairCandidateRejectionCount: 0,
    }
    this.highDensitySolver = new HighDensitySolver({
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
      growShrinkSolutionValidator: (routes) =>
        this.prepareCandidateRoutes(routes) !== undefined,
    })
    this.activeSubSolver = this.highDensitySolver
    this.MAX_ITERATIONS = 100e6 * params.effort
  }

  override getSolverName(): string {
    return "Pipeline9RegionalFallbackSolver"
  }

  private getViaToPadConflictCount(routes: HighDensityRoute[]): number {
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
      return 0
    }
    return getPreloadedViaToBoardObstacleConflictCount({
      routes,
      movablePreloadedConnectionNames,
      boardObstacles,
      connMap: this.params.connMap,
      layerCount: this.params.layerCount,
      viaToPadClearance,
    })
  }

  private prepareCandidateRoutes(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] | undefined {
    let materializedRoutes: HighDensityRoute[]
    try {
      materializedRoutes = materializePipeline9HdRouteVias(routes)
    } catch (error) {
      this.stats.invalidLayerTransitionCandidateRejectionCount =
        Number(
          this.stats.invalidLayerTransitionCandidateRejectionCount ?? 0,
        ) + 1
      this.stats.firstInvalidLayerTransitionCandidateError ??=
        error instanceof Error ? error.message : String(error)
      return undefined
    }
    if (this.getViaToPadConflictCount(materializedRoutes) === 0) {
      return materializedRoutes
    }

    const { boardObstacles, viaToPadClearance } = this.params
    if (!boardObstacles || viaToPadClearance === undefined) {
      return materializedRoutes
    }
    const node = this.params.nodeWithPortPoints
    const relaxedRoutes = applyViaToPadClearanceRelaxation(
      {
        layerCount: this.params.layerCount,
        minTraceWidth: this.params.traceWidth,
        minViaDiameter: this.params.viaDiameter,
        minViaEdgeToPadEdgeClearance: viaToPadClearance,
        obstacles: boardObstacles,
        connections: [],
        bounds: {
          minX: node.center.x - node.width / 2,
          maxX: node.center.x + node.width / 2,
          minY: node.center.y - node.height / 2,
          maxY: node.center.y + node.height / 2,
        },
      },
      materializedRoutes,
      this.params.connMap,
    )
    if (this.getViaToPadConflictCount(relaxedRoutes) > 0) {
      this.stats.preloadedViaCandidateRejectionCount =
        Number(this.stats.preloadedViaCandidateRejectionCount ?? 0) + 1
      return undefined
    }
    return relaxedRoutes
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
      const routedCandidate = this.prepareCandidateRoutes(
        this.highDensitySolver.routes,
      )
      if (!routedCandidate) {
        this.error =
          "Pipeline9 regional route output failed its candidate validator"
        this.failed = true
        return
      }
      this.acceptedRoutes = routedCandidate
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
      const preparedForceImprovedRoutes =
        this.prepareCandidateRoutes(forceImprovedRoutes)
      if (!preparedForceImprovedRoutes) {
        this.stats.forceImproveCandidateRejectionCount =
          Number(this.stats.forceImproveCandidateRejectionCount ?? 0) + 1
      } else {
        this.acceptedRoutes = preparedForceImprovedRoutes
      }
      this.repairSolver = new Pipeline4HighDensityRepairSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        hdRoutes: this.acceptedRoutes!,
        obstacles: this.params.obstacles,
        colorMap: this.params.colorMap,
        repairMargin: this.params.obstacleMargin,
        maxSampleEntries: 80,
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
      const preparedRepairedRoutes = this.prepareCandidateRoutes(repairedRoutes)
      if (!preparedRepairedRoutes) {
        this.stats.repairCandidateRejectionCount =
          Number(this.stats.repairCandidateRejectionCount ?? 0) + 1
      } else {
        this.acceptedRoutes = preparedRepairedRoutes
      }
      this.activeSubSolver = null
      this.phase = "done"
      this.solved = true
      return
    }
  }

  getOutput(): HighDensityRoute[] {
    return (
      this.acceptedRoutes ??
      this.repairSolver?.getOutput() ??
      this.forceImproveSolver?.getOutput() ??
      this.highDensitySolver.routes
    )
  }

  override visualize(): GraphicsObject {
    return (
      this.repairSolver?.visualize() ??
      this.forceImproveSolver?.visualize() ??
      this.highDensitySolver.visualize()
    )
  }
}
