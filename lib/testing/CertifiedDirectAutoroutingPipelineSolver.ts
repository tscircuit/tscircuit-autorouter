import {
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  type AutoroutingPipelineSolverOptions,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import {
  getCertifiedDirectRoutingPlan,
  type CertifiedDirectRoutingPlan,
} from "./getCertifiedDirectRoutingPlan"

/** Explicit opt-in selector. Both alternatives are chosen before solver work. */
export class CertifiedDirectAutoroutingPipelineSolver extends BaseSolver {
  readonly selection: Omit<Extract<CertifiedDirectRoutingPlan, { eligible: true }>, "traces"> | Extract<CertifiedDirectRoutingPlan, { eligible: false }>
  readonly selectedStrategy: "certified-direct" | "pipeline9"
  readonly pipeline9?: AutoroutingPipelineSolver9_PreloadedTraceGraph
  readonly timeSpentOnPhase: Record<string, number>
  readonly startTimeOfPhase: Record<string, number>
  readonly endTimeOfPhase: Record<string, number>
  readonly pipelineDef: Array<{ solverName: string }>
  currentPipelineStepIndex = 0
  private readonly directOriginal?: SimpleRouteJson
  private readonly directTraces?: SimplifiedPcbTraces

  constructor(
    readonly srj: SimpleRouteJson,
    readonly opts: AutoroutingPipelineSolverOptions = {},
  ) {
    super()
    const start = performance.now()
    const configuredOption = Object.entries(opts).find(([key, value]) =>
      value !== undefined && !["effort", "cacheProvider"].includes(key),
    )
    const incompatibleEffort = opts.effort !== undefined && (!Number.isFinite(opts.effort) || opts.effort <= 0)
    // A configured policy must retain the exact general solver semantics.
    const plan: CertifiedDirectRoutingPlan = configuredOption || incompatibleEffort || (opts.cacheProvider !== undefined && opts.cacheProvider !== null)
      ? { eligible: false, reason: configuredOption ? `configured-pipeline-option:${configuredOption[0]}` : incompatibleEffort ? "configured-effort-outside-direct-contract" : "configured-cache-provider",
          diagnostics: { branchCount: 0, checkedBranches: 0, geometryChecks: 0, candidatesChecked: 0 } }
      : getCertifiedDirectRoutingPlan(srj)
    const eligibilityMs = performance.now() - start
    this.selection = plan.eligible ? { eligible: true, diagnostics: plan.diagnostics } : plan
    this.selectedStrategy = this.selection.eligible ? "certified-direct" : "pipeline9"
    if (plan.eligible) {
      this.directOriginal = structuredClone(srj)
      this.directTraces = plan.traces
      this.pipelineDef = [{ solverName: "certifiedDirectRouting" }]
      this.MAX_ITERATIONS = 1
      this.timeSpentOnPhase = {}
      this.startTimeOfPhase = {}
      this.endTimeOfPhase = {}
    } else {
      // No direct solver has run or failed. Original input and options are
      // passed unchanged to the general solver selected by applicability.
      this.pipeline9 = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, opts)
      this.pipelineDef = this.pipeline9.pipelineDef
      this.MAX_ITERATIONS = this.pipeline9.MAX_ITERATIONS
      this.timeSpentOnPhase = this.pipeline9.timeSpentOnPhase
      this.startTimeOfPhase = this.pipeline9.startTimeOfPhase
      this.endTimeOfPhase = this.pipeline9.endTimeOfPhase
    }
    this.timeSpentOnPhase.certifiedDirectEligibility = eligibilityMs
    this.stats = { selectedStrategy: this.selectedStrategy, directEligibility: this.selection.diagnostics,
      directIneligibilityReason: this.selection.eligible ? null : this.selection.reason,
      pipeline9StagesExecuted: 0, searchExpansions: 0 }
  }

  getConstructorParams(): readonly [SimpleRouteJson, AutoroutingPipelineSolverOptions] {
    return [this.srj, this.opts]
  }

  getCurrentPhase(): string {
    if (this.pipeline9) return this.pipeline9.getCurrentPhase()
    return this.solved ? "none" : "certifiedDirectRouting"
  }

  _step(): void {
    if (this.pipeline9) {
      this.pipeline9.step()
      this.MAX_ITERATIONS = this.pipeline9.MAX_ITERATIONS
      this.activeSubSolver = this.pipeline9.activeSubSolver
      this.solved = this.pipeline9.solved
      this.failed = this.pipeline9.failed
      this.error = this.pipeline9.error
      this.progress = this.pipeline9.progress
      this.currentPipelineStepIndex = this.pipeline9.currentPipelineStepIndex
      this.stats.pipeline9StagesExecuted = this.pipeline9.currentPipelineStepIndex
      return
    }
    if (!this.selection.eligible || !this.directTraces) throw new Error("Certified direct selection lacks a qualified plan")
    this.stats.acceptedAgainstOriginalInput = true
    this.stats.acceptedBranches = this.directTraces.length
    this.stats.acceptedThroughVias = this.directTraces.reduce((sum, trace) => sum + trace.route.filter((point) => point.route_type === "via").length, 0)
    this.solved = true
    this.progress = 1
    this.currentPipelineStepIndex = 1
  }

  async solveAsync(runtime?: SolverRuntimeExecutor): Promise<void> {
    if (!this.pipeline9) { this.solve(); return }
    try {
      await this.pipeline9.solveAsync(runtime)
    } finally {
      this.iterations = this.pipeline9.iterations
      this.MAX_ITERATIONS = this.pipeline9.MAX_ITERATIONS
      this.activeSubSolver = this.pipeline9.activeSubSolver
      this.solved = this.pipeline9.solved
      this.failed = this.pipeline9.failed
      this.error = this.pipeline9.error
      this.progress = this.pipeline9.progress
      this.timeToSolve = this.pipeline9.timeToSolve
      this.currentPipelineStepIndex = this.pipeline9.currentPipelineStepIndex
      this.stats.pipeline9StagesExecuted = this.pipeline9.currentPipelineStepIndex
    }
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (this.pipeline9) return this.pipeline9.getOutputSimplifiedPcbTraces()
    if (!this.solved || !this.selection.eligible || !this.directTraces) throw new Error("Cannot get certified direct output before solve")
    return this.directTraces
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    if (this.pipeline9) return this.pipeline9.getOutputSimpleRouteJson()
    if (!this.directOriginal) throw new Error("Certified direct original input is missing")
    return { ...structuredClone(this.directOriginal), traces: this.getOutputSimplifiedPcbTraces() }
  }
}
