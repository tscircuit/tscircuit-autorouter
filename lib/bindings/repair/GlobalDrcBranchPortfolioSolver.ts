import { initializeAutorouterBindings } from "../initializeAutorouterBindings"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { DrcEvaluator, GlobalDrcBranchPortfolioSolverParams, HighDensityRoute } from "high-density-repair03/lib"
import * as bindings from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { loadAutorouterBindings, type AutorouterBindingsInput } from "../../../rust/autorouter-bindings/ts/index"
import {
  type RepairPortfolioDescriptor,
  type RepairPortfolio,
  type RepairEvaluationCounters,
  type PreparedRepairDrc,
} from "./repairPortfolio"

export class GlobalDrcBranchPortfolioSolver extends BaseSolver implements RepairPortfolio {
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

export async function loadRepairPortfolioBindings(input: AutorouterBindingsInput): Promise<void> {
  await loadAutorouterBindings(input)
}
