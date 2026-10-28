import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import { createPipeline9RegularNodeSolverFromCanonicalNode } from "./Pipeline9HighDensitySolver"
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
import { hasPipeline9OriginalPhysicalContext } from "./hasPipeline9OriginalPhysicalContext"
import { arePipeline9NativeRoutesPhysicallyValid } from "./arePipeline9NativeRoutesPhysicallyValid"
import type { Pipeline9PhysicalOwnership } from "./getPipeline9PhysicalOwnership"
import { Pipeline9HighDensityForceImproveSolver } from "./Pipeline9HighDensityForceImproveSolver"

type Pipeline9RegionalFallbackSolverParams = {
  cacheProvider?: null
  /** Only owned local routing supplies the complete native physical context. */
  useNativeRouting?: boolean
  boardGeometry?: HighDensityBoardGeometry
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  priorityDiagnostics?: Record<string, number>
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  connMap: ConnectivityMap
  /** Complete original context is separate from legacy boardObstacles search input. */
  physicalOwnership?: Pipeline9PhysicalOwnership
  physicalBoardObstacles?: Obstacle[]
  immutableRoutes?: HighDensityRoute[]
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
  nodePfById?:
    | Map<CapacityMeshNodeId, number | null>
    | Record<string, number | null>
  obstacles: Obstacle[]
  boardObstacles?: Obstacle[]
  physicalTraceClearance?: number
  traceToPadClearance?: number
  traceToHoleClearance?: number
  physicalRouteDimensionsByConnectionName?: Readonly<Record<string, {
    traceThickness: number
    viaDiameter: number
  }>>
  movablePreloadedConnectionNames?: ReadonlySet<string>
  viaToPadClearance?: number
  layerCount: number
  allowBlindAndBuriedVias?: boolean
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
  readonly hasOriginalPhysicalContext: boolean
  readonly highDensitySolver: HighDensitySolver
  forceImproveSolver?: HighDensityForceImproveSolver
  repairSolver?: Pipeline4HighDensityRepairSolver
  private phase: RegionalFallbackPhase = "route"
  private readonly nativePriorityInstancesBefore: number
  private readonly nativePriorityCompletedWorkBefore: number

  constructor(params: Pipeline9RegionalFallbackSolverParams) {
    super()
    this.hasOriginalPhysicalContext = hasPipeline9OriginalPhysicalContext(params)
    this.params = params
    this.nativePriorityInstancesBefore = params.priorityDiagnostics?.priorityInstances ?? 0
    this.nativePriorityCompletedWorkBefore = params.priorityDiagnostics?.priorityCompletedWorkUnits ?? 0
    if (params.useNativeRouting && params.priorityDiagnostics) {
      params.priorityDiagnostics.regionalNativeRouteInstances =
        (params.priorityDiagnostics.regionalNativeRouteInstances ?? 0) + 1
    }
    this.stats = {
      preloadedViaCandidateRejectionCount: 0,
      forceImproveCandidateRejectionCount: 0,
      repairCandidateRejectionCount: 0,
    }
    const growShrinkSolutionValidator =
      params.immutableRoutes?.length || (params.boardObstacles &&
      params.movablePreloadedConnectionNames &&
      params.viaToPadClearance !== undefined)
        ? (routes: HighDensityRoute[]): boolean => this.validateCandidateRoutes(routes)
        : undefined
    this.highDensitySolver = params.useNativeRouting ? createPipeline9RegularNodeSolverFromCanonicalNode({
      cacheProvider: params.cacheProvider,
      nodeWithPortPoints: params.nodeWithPortPoints,
      colorMap: params.colorMap,
      connMap: params.connMap,
      physicalOwnership: params.physicalOwnership,
      physicalImmutableRoutes: params.immutableRoutes,
      viaDiameter: params.viaDiameter,
      traceWidth: params.traceWidth,
      obstacleMargin: params.obstacleMargin,
      effort: params.effort,
      nodePfById: params.nodePfById ?? new Map(),
      obstacles: params.obstacles,
      physicalBoardObstacles: params.physicalBoardObstacles,
      physicalTraceClearance: params.physicalTraceClearance,
      traceToPadClearance: params.traceToPadClearance,
      traceToHoleClearance: params.traceToHoleClearance,
      physicalRouteDimensionsByConnectionName: params.physicalRouteDimensionsByConnectionName,
      viaToPadClearance: params.viaToPadClearance,
      layerCount: params.layerCount,
      boardGeometry: params.boardGeometry,
      viaHoleDiameter: params.viaHoleDiameter,
      minViaHoleEdgeToViaHoleEdgeClearance:
        params.minViaHoleEdgeToViaHoleEdgeClearance,
      allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
      priorityDagSearch: true,
      priorityDiagnostics: params.priorityDiagnostics,
      // Keep regional search's existing family allowance; this experiment
      // changes native priority routing and geometry context without adding A13.
      enableNegotiatedSearch: false,
      growShrinkSolutionValidator,
    }) : new HighDensitySolver({
      cacheProvider: params.cacheProvider,
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
      growShrinkSolutionValidator,
    })
    this.activeSubSolver = this.highDensitySolver
    this.MAX_ITERATIONS = 100e6 * params.effort
  }

  override getSolverName(): string {
    return "Pipeline9RegionalFallbackSolver"
  }

  private validateCandidateRoutes(routes: HighDensityRoute[]): boolean {
    const hasNativePhysicalConflict = ((this.params.useNativeRouting && this.hasOriginalPhysicalContext) || this.params.immutableRoutes?.length) && !arePipeline9NativeRoutesPhysicallyValid({
      routes,
      immutableRoutes: this.params.immutableRoutes,
      routeDimensionsByConnectionName: this.params.physicalRouteDimensionsByConnectionName,
      connMap: this.params.connMap,
      physicalOwnership: this.params.physicalOwnership,
      layerCount: this.params.layerCount,
      allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
      traceClearance: this.params.physicalTraceClearance ?? 0.1,
      traceToPadClearance: this.params.traceToPadClearance,
      traceToHoleClearance: this.params.traceToHoleClearance,
      viaHoleDiameter: this.params.viaHoleDiameter ?? this.params.viaDiameter,
      minViaHoleEdgeToViaHoleEdgeClearance:
        this.params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
      boardObstacles: this.hasOriginalPhysicalContext ? this.params.physicalBoardObstacles! : [],
      viaToPadClearance: this.params.viaToPadClearance ?? 0.1,
    })
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
      return !hasNativePhysicalConflict
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
    return !hasViaConflict && !hasNativePhysicalConflict
  }

  private recordNativeRouteDiagnostics(): void {
    const diagnostics = this.params.priorityDiagnostics
    if (!this.params.useNativeRouting || !diagnostics) return
    diagnostics.regionalNativePriorityInstances =
      (diagnostics.regionalNativePriorityInstances ?? 0) +
      (diagnostics.priorityInstances ?? 0) - this.nativePriorityInstancesBefore
    // This is only the existing completed-priority-candidate clock. It does
    // not claim work for unfinished candidates or other portfolio families.
    diagnostics.regionalNativePriorityCompletedWorkUnits =
      (diagnostics.regionalNativePriorityCompletedWorkUnits ?? 0) +
      (diagnostics.priorityCompletedWorkUnits ?? 0) - this.nativePriorityCompletedWorkBefore
  }

  override _step(): void {
    if (this.phase === "route") {
      this.highDensitySolver.step()
      if (this.highDensitySolver.failed) {
        this.recordNativeRouteDiagnostics()
        this.error = this.highDensitySolver.error
        this.failed = true
        return
      }
      if (!this.highDensitySolver.solved) return
      this.recordNativeRouteDiagnostics()
      const routedCandidate = materializePipeline9HdRouteVias(
        this.highDensitySolver.routes,
      )
      if (!this.validateCandidateRoutes(routedCandidate)) {
        this.error =
          "Pipeline9 regional route output failed its candidate validator"
        this.failed = true
        return
      }
      this.forceImproveSolver = new Pipeline9HighDensityForceImproveSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        hdRoutes: routedCandidate,
        colorMap: this.params.colorMap,
        totalStepsPerNode: Math.max(12, Math.round(20 * this.params.effort)),
        nodeAssignmentMargin: this.params.obstacleMargin,
        physicalValidation: (this.params.useNativeRouting && this.hasOriginalPhysicalContext) || this.params.immutableRoutes?.length ? {
          connectivityNetMap: this.params.connMap.netMap,
          physicalOwnership: this.params.physicalOwnership,
          immutableRoutes: this.params.immutableRoutes,
          layerCount: this.params.layerCount,
          allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
          traceClearance: this.params.physicalTraceClearance ?? 0.1,
          traceToPadClearance: this.params.traceToPadClearance,
          traceToHoleClearance: this.params.traceToHoleClearance,
          viaHoleDiameter: this.params.viaHoleDiameter ?? this.params.viaDiameter,
          minViaHoleEdgeToViaHoleEdgeClearance:
            this.params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
          boardObstacles: this.hasOriginalPhysicalContext ? this.params.physicalBoardObstacles! : [],
          viaToPadClearance: this.params.viaToPadClearance ?? 0.1,
          routeDimensionsByConnectionName: this.params.physicalRouteDimensionsByConnectionName,
        } : undefined,
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
      if (!this.validateCandidateRoutes(forceImprovedRoutes)) {
        this.stats.forceImproveCandidateRejectionCount =
          Number(this.stats.forceImproveCandidateRejectionCount ?? 0) + 1
        this.error =
          "Pipeline9 regional force-improve output failed its candidate validator"
        this.failed = true
        return
      }
      this.repairSolver = new Pipeline4HighDensityRepairSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        hdRoutes: forceImprovedRoutes,
        obstacles: this.params.obstacles,
        colorMap: this.params.colorMap,
        repairMargin: this.params.obstacleMargin,
        minimumTraceWidth: this.params.traceWidth,
        connMap: this.params.connMap,
        ...(this.params.useNativeRouting ? {
          viaSpanContext: {
            layerCount: this.params.layerCount,
            allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
          },
        } : {}),
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
        this.stats.repairCandidateRejectionCount =
          Number(this.stats.repairCandidateRejectionCount ?? 0) + 1
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
  }

  getOutput(): HighDensityRoute[] {
    return (
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
