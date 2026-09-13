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

const getPreloadedViaToBoardObstacleConflicts = ({
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
}) => {
  const conflicts = []
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
        const distance = getPointToObstacleDistance(via.center, obstacle)
        const requiredDistance = via.diameter / 2 + viaToPadClearance
        if (distance < requiredDistance) {
          conflicts.push({
            routeConnectionName: route.connectionName,
            via,
            obstacle,
            obstacleId: obstacle.obstacleId,
            obstacleCenter: obstacle.center,
            obstacleWidth: obstacle.width,
            obstacleHeight: obstacle.height,
            obstacleLayers: obstacle.layers,
            distance,
            requiredDistance,
          })
        }
      }
    }
  }
  return conflicts
}

const toObstacleLocalPoint = (
  point: { x: number; y: number },
  obstacle: Obstacle,
) => {
  const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  return {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

const fromObstacleLocalPoint = (
  point: { x: number; y: number },
  obstacle: Obstacle,
) => {
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  return {
    x:
      obstacle.center.x +
      point.x * Math.cos(radians) -
      point.y * Math.sin(radians),
    y:
      obstacle.center.y +
      point.x * Math.sin(radians) +
      point.y * Math.cos(radians),
  }
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

/** Runs the regular high-density cleanup pipeline for a B01 fallback region. */
export class Pipeline9RegionalFallbackSolver extends BaseSolver {
  readonly params: Pipeline9RegionalFallbackSolverParams
  readonly highDensitySolver: HighDensitySolver
  clearanceRelaxationHighDensitySolver?: HighDensitySolver
  forceImproveSolver?: HighDensityForceImproveSolver
  repairSolver?: Pipeline4HighDensityRepairSolver
  private routedCandidate?: HighDensityRoute[]
  private acceptedRoutes?: HighDensityRoute[]
  private phase: RegionalFallbackPhase = "route"

  constructor(params: Pipeline9RegionalFallbackSolverParams) {
    super()
    this.params = params
    this.stats = {
      routedCandidateRejectionCount: 0,
      preloadedViaCandidateRejectionCount: 0,
      forceImproveCandidateRejectionCount: 0,
      repairCandidateRejectionCount: 0,
    }
    this.highDensitySolver = this.createHighDensitySolver(false)
    this.activeSubSolver = this.highDensitySolver
    this.MAX_ITERATIONS = 100e6 * params.effort
  }

  override getSolverName(): string {
    return "Pipeline9RegionalFallbackSolver"
  }

  private createHighDensitySolver(validateViaClearance: boolean) {
    const params = this.params
    return new HighDensitySolver({
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
      growShrinkSolutionValidator: validateViaClearance
        ? (routes) => this.validateCandidateRoutes(routes)
        : (routes) => this.hasMaterializableLayerTransitions(routes),
    })
  }

  private hasMaterializableLayerTransitions(routes: HighDensityRoute[]) {
    try {
      materializePipeline9HdRouteVias(routes)
      return true
    } catch (error) {
      this.stats.invalidLayerTransitionCandidateRejectionCount =
        Number(
          this.stats.invalidLayerTransitionCandidateRejectionCount ?? 0,
        ) + 1
      this.stats.firstInvalidLayerTransitionCandidateError ??=
        error instanceof Error ? error.message : String(error)
      return false
    }
  }

  private getViaToPadConflicts(routes: HighDensityRoute[]) {
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
      return []
    }
    return getPreloadedViaToBoardObstacleConflicts({
      routes,
      movablePreloadedConnectionNames,
      boardObstacles,
      connMap: this.params.connMap,
      layerCount: this.params.layerCount,
      viaToPadClearance,
    })
  }

  private escapeViasFromPadForceCancellation(routes: HighDensityRoute[]) {
    let currentRoutes = routes
    const node = this.params.nodeWithPortPoints
    const bounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }
    const maximumAcceptedMoves = routes.reduce(
      (count, route) => count + route.vias.length,
      0,
    )

    for (
      let acceptedMoveCount = 0;
      acceptedMoveCount < maximumAcceptedMoves;
      acceptedMoveCount++
    ) {
      const conflicts = this.getViaToPadConflicts(currentRoutes)
      const conflict = conflicts[0]
      if (!conflict) return currentRoutes

      const localVia = toObstacleLocalPoint(
        conflict.via.center,
        conflict.obstacle,
      )
      const halfWidth = conflict.obstacle.width / 2
      const halfHeight = conflict.obstacle.height / 2
      const offset = conflict.requiredDistance + 0.006
      const candidateCenters = [
        {
          x: -halfWidth - offset,
          y: clampNumber(localVia.y, -halfHeight, halfHeight),
        },
        {
          x: halfWidth + offset,
          y: clampNumber(localVia.y, -halfHeight, halfHeight),
        },
        {
          x: clampNumber(localVia.x, -halfWidth, halfWidth),
          y: -halfHeight - offset,
        },
        {
          x: clampNumber(localVia.x, -halfWidth, halfWidth),
          y: halfHeight + offset,
        },
      ]
        .map((point) => fromObstacleLocalPoint(point, conflict.obstacle))
        .filter((point) => {
          const radius = conflict.via.diameter / 2
          return (
            point.x - radius >= bounds.minX &&
            point.x + radius <= bounds.maxX &&
            point.y - radius >= bounds.minY &&
            point.y + radius <= bounds.maxY
          )
        })
        .sort(
          (left, right) =>
            Math.hypot(
              left.x - conflict.via.center.x,
              left.y - conflict.via.center.y,
            ) -
            Math.hypot(
              right.x - conflict.via.center.x,
              right.y - conflict.via.center.y,
            ),
        )

      let bestCandidate:
        | { routes: HighDensityRoute[]; conflictCount: number }
        | undefined
      for (const center of candidateCenters) {
        this.stats.viaPadEscapeCandidateAttemptCount =
          Number(this.stats.viaPadEscapeCandidateAttemptCount ?? 0) + 1
        const candidateRoutes = currentRoutes.map((route) => {
          if (route.connectionName !== conflict.routeConnectionName) {
            return route
          }
          const matchesVia = (point: { x: number; y: number }) =>
            Math.hypot(
              point.x - conflict.via.center.x,
              point.y - conflict.via.center.y,
            ) <= 1e-6
          return {
            ...route,
            route: route.route.map((point) =>
              matchesVia(point) ? { ...point, ...center } : point,
            ),
            vias: route.vias.map((via) =>
              matchesVia(via) ? { ...via, ...center } : via,
            ),
          }
        })
        const candidateConflictCount =
          this.getViaToPadConflicts(candidateRoutes).length
        if (
          candidateConflictCount < conflicts.length &&
          (!bestCandidate ||
            candidateConflictCount < bestCandidate.conflictCount)
        ) {
          bestCandidate = {
            routes: candidateRoutes,
            conflictCount: candidateConflictCount,
          }
        }
      }
      if (!bestCandidate) return currentRoutes
      currentRoutes = bestCandidate.routes
      this.stats.viaPadEscapeAcceptedMoveCount =
        Number(this.stats.viaPadEscapeAcceptedMoveCount ?? 0) + 1
    }
    return currentRoutes
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
      return materializedRoutes
    }
    const getViaConflict = (candidateRoutes: HighDensityRoute[]) =>
      this.getViaToPadConflicts(candidateRoutes)[0]
    const directConflict = getViaConflict(materializedRoutes)
    if (!directConflict) {
      return materializedRoutes
    }
    const relaxedRoutes = this.relaxViaToPadClearance(materializedRoutes)
    const escapedRoutes = this.escapeViasFromPadForceCancellation(relaxedRoutes)
    const viaConflict = getViaConflict(escapedRoutes)
    if (viaConflict) {
      this.stats.preloadedViaCandidateRejectionCount =
        Number(this.stats.preloadedViaCandidateRejectionCount ?? 0) + 1
      this.stats.firstPreloadedViaCandidateConflict ??= viaConflict
      this.stats.lastPreloadedViaCandidateConflict = viaConflict
    }
    return viaConflict ? undefined : escapedRoutes
  }

  private validateCandidateRoutes(routes: HighDensityRoute[]): boolean {
    return this.prepareCandidateRoutes(routes) !== undefined
  }

  private relaxViaToPadClearance(routes: HighDensityRoute[]) {
    const { boardObstacles, viaToPadClearance } = this.params
    if (!boardObstacles || viaToPadClearance === undefined) return routes

    const node = this.params.nodeWithPortPoints
    return applyViaToPadClearanceRelaxation(
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
      routes,
      this.params.connMap,
    )
  }

  override _step(): void {
    if (this.phase === "route") {
      const routeSolver =
        this.clearanceRelaxationHighDensitySolver ?? this.highDensitySolver
      routeSolver.step()
      if (routeSolver.failed) {
        if (
          !this.clearanceRelaxationHighDensitySolver &&
          this.params.boardObstacles &&
          this.params.viaToPadClearance !== undefined
        ) {
          this.clearanceRelaxationHighDensitySolver =
            this.createHighDensitySolver(true)
          this.stats.clearanceValidatedSearchStarted = true
          this.activeSubSolver = this.clearanceRelaxationHighDensitySolver
          return
        }
        this.error = routeSolver.error
        this.failed = true
        return
      }
      if (!routeSolver.solved) return
      const routedCandidate = this.prepareCandidateRoutes(
        routeSolver.routes,
      )
      if (!routedCandidate) {
        this.stats.routedCandidateRejectionCount =
          Number(this.stats.routedCandidateRejectionCount ?? 0) + 1
        if (!this.clearanceRelaxationHighDensitySolver) {
          this.clearanceRelaxationHighDensitySolver =
            this.createHighDensitySolver(true)
          this.stats.clearanceValidatedSearchStarted = true
          this.activeSubSolver = this.clearanceRelaxationHighDensitySolver
          return
        }
        this.error =
          "Pipeline9 regional route output failed its candidate validator"
        this.failed = true
        return
      }
      this.routedCandidate = routedCandidate
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
      }
      if (preparedForceImprovedRoutes) {
        this.acceptedRoutes = preparedForceImprovedRoutes
      }
      this.repairSolver = new Pipeline4HighDensityRepairSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        // Force improvement is optional cleanup. If it moves a valid route
        // into a forbidden via-to-pad condition, keep the already-validated
        // routed candidate and let the repair stage continue from it.
        hdRoutes: preparedForceImprovedRoutes
          ? preparedForceImprovedRoutes
          : this.routedCandidate!,
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
        if (!this.acceptedRoutes) {
          this.error =
            "Pipeline9 regional repair output failed its candidate validator"
          this.failed = true
          return
        }
        this.activeSubSolver = null
        this.phase = "done"
        this.solved = true
        return
      }
      this.acceptedRoutes = preparedRepairedRoutes
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
      this.clearanceRelaxationHighDensitySolver?.routes ??
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
