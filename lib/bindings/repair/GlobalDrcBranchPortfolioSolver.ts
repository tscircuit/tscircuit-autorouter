import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { DrcEvaluator, GlobalDrcBranchPortfolioSolverParams, HighDensityRoute } from "high-density-repair03/lib"
import * as bindings from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import type { AutoroutingDrcEngine } from "lib/bindings/repair/AutoroutingDrcEngine"
import type { AutoroutingDrcEngineOptions, SimpleRouteJson as RepairSimpleRouteJson } from "high-density-repair03/lib"
import type { Obstacle, SimpleRouteConnection, SimplifiedPcbTrace } from "lib/types"

export type RepairPortfolioDescriptor = {
  engineSrj: RepairSimpleRouteJson
  engineOptions: Omit<AutoroutingDrcEngineOptions, "connMap">
  solverSrj: RepairSimpleRouteJson
  connMap: { netMap: Record<string, string[]>; idToNetMap: Record<string, string> } | null
  originalTraces: SimplifiedPcbTrace[]
  newConnections: SimpleRouteConnection[]
  originalConnections: SimpleRouteConnection[]
  layerCount: number
  defaultViaHoleDiameter: number
  obstacles: Obstacle[]
  movablePreloadedSections: Array<{
    syntheticConnectionName: string
    evaluationTraceId: string
    originalTrace: SimplifiedPcbTrace
  }>
  nonMovableMutatedPreloadedTraces: SimplifiedPcbTrace[]
}

export type PreparedRepairDrc = {
  engine: AutoroutingDrcEngine
  baseline: { errors: unknown[]; errorsWithCenters: unknown[] }
}

export type RepairEvaluationCounters = {
  indexedDrcEvaluationCount: number
  indexedDrcCacheHitCount: number
  indexedDrcCandidateCacheSize: number
  indexedDrcEvaluationTimeMs?: number
}

export class GlobalDrcBranchPortfolioSolver extends BaseSolver {
  private binding: bindings.GlobalDrcBranchPortfolioSolver | undefined
  private output: HighDensityRoute[]

  constructor(
    readonly params: GlobalDrcBranchPortfolioSolverParams,
    descriptor: RepairPortfolioDescriptor,
    referenceEvaluator: DrcEvaluator,
    preparedDrc?: PreparedRepairDrc,
  ) {
    super()
    initializeAutorouterBindings()
    this.output = params.hdRoutes
    const {
      drcEvaluator, viaInPadDrcEvaluator, referenceDrcEvaluator,
      autoroutingDrcEngine, connMap, ...input
    } = params
    const repairDescriptor = preparedDrc
      ? { ...descriptor, engineSrj: undefined, engineOptions: undefined, preparedBaseline: preparedDrc.baseline }
      : descriptor
    this.binding = new bindings.GlobalDrcBranchPortfolioSolver(input, repairDescriptor, (routes) => {
      return referenceEvaluator({ traces: [], routes, hdRoutes: routes })
    }, preparedDrc?.engine.forkForRepair())
  }

  override _step(): void {
    const binding = this.binding
    if (!binding) throw new Error("Repair portfolio has been disposed")
    try {
      const state = binding.step()
      this.solved = state.solved
      this.failed = state.failed
      this.error = state.error
      this.iterations = state.iterations
      this.MAX_ITERATIONS = state.maxIterations
      this.progress = state.progress
      this.stats = state.stats
      if (this.solved || this.failed) {
        this.output = binding.getOutput()
        binding.free()
        this.binding = undefined
      }
    } catch (error) {
      if (this.binding) {
        this.binding.free()
        this.binding = undefined
      }
      throw error
    }
  }

  override getOutput(): HighDensityRoute[] {
    return this.binding
      ? this.binding.getOutput()
      : this.output
  }

  getRepairEvaluationCounters(): RepairEvaluationCounters {
    return {
      indexedDrcEvaluationCount: this.stats.indexedDrcEvaluationCount,
      indexedDrcCacheHitCount: this.stats.indexedDrcCacheHitCount,
      indexedDrcCandidateCacheSize: this.stats.indexedDrcCandidateCacheSize,
      indexedDrcEvaluationTimeMs: this.stats.indexedDrcEvaluationTimeMs,
    }
  }
}
