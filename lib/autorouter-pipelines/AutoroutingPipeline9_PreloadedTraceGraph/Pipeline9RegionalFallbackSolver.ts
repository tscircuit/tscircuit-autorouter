import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { hasPipeline9ViaToBoardObstacleConflict } from "./hasPipeline9ViaToBoardObstacleConflict"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"

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

/** Runs the regular high-density cleanup pipeline for a B01 fallback region. */
export class Pipeline9RegionalFallbackSolver extends BaseSolver {
  readonly params: Pipeline9RegionalFallbackSolverParams
  readonly highDensitySolver: HighDensitySolver
  forceImproveSolver?: HighDensityForceImproveSolver
  repairSolver?: Pipeline4HighDensityRepairSolver
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
      growShrinkSolutionValidator:
        params.boardObstacles &&
        params.movablePreloadedConnectionNames &&
        params.viaToPadClearance !== undefined
          ? (routes) => this.validateCandidateRoutes(routes)
          : undefined,
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
    const hasViaConflict = hasPipeline9ViaToBoardObstacleConflict({
      routes,
      connectionNamesToValidate: movablePreloadedConnectionNames,
      boardObstacles,
      connMap: this.params.connMap,
      layerCount: this.params.layerCount,
      viaToPadClearance,
    })
    if (hasViaConflict) {
      this.stats.preloadedViaCandidateRejectionCount =
        Number(this.stats.preloadedViaCandidateRejectionCount ?? 0) + 1
    }
    return !hasViaConflict
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
      if (!this.validateCandidateRoutes(routedCandidate)) {
        this.error =
          "Pipeline9 regional route output failed its candidate validator"
        this.failed = true
        return
      }
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
