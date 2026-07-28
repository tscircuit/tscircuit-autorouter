import type {
  DrcEvaluator,
  DrcSnapshot,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { TraceSimplificationSolver } from "./TraceSimplificationSolver"

type TraceSimplificationSolverParams = ConstructorParameters<
  typeof TraceSimplificationSolver
>[0]

export type DrcGuardedTraceSimplificationSolverParams =
  TraceSimplificationSolverParams & {
    readonly srj: SimpleRouteJson
    readonly drcEvaluator: DrcEvaluator
  }

export type DrcGuardedTraceSimplificationDecision = {
  accepted: boolean
  inputDrc: DrcSnapshot
  candidateDrc: DrcSnapshot
}

export class DrcGuardedTraceSimplificationSolver extends TraceSimplificationSolver {
  readonly inputHdRoutes: HighDensityRoute[]
  readonly drcSrj: SimpleRouteJson
  readonly drcEvaluator: DrcEvaluator
  readonly drcConnMap: TraceSimplificationSolverParams["connMap"]
  decision?: DrcGuardedTraceSimplificationDecision

  constructor(params: DrcGuardedTraceSimplificationSolverParams) {
    const { srj, drcEvaluator, ...simplificationParams } = params
    super(simplificationParams)
    this.inputHdRoutes = structuredClone(Array.from(params.hdRoutes))
    this.drcSrj = srj
    this.drcEvaluator = drcEvaluator
    this.drcConnMap = params.connMap
  }

  override getSolverName(): string {
    return "DrcGuardedTraceSimplificationSolver"
  }

  override _step(): void {
    super._step()
    if (!this.solved || this.failed || this.decision) return

    const candidateHdRoutes = this.simplifiedHdRoutes
    const inputDrc = getDrcSnapshot(
      this.drcSrj,
      this.inputHdRoutes,
      this.drcEvaluator,
      this.drcConnMap,
    )
    const candidateDrc = getDrcSnapshot(
      this.drcSrj,
      candidateHdRoutes,
      this.drcEvaluator,
      this.drcConnMap,
    )
    const accepted =
      candidateDrc.count < inputDrc.count ||
      (candidateDrc.count === inputDrc.count &&
        candidateDrc.issueScore <= inputDrc.issueScore)

    this.decision = { accepted, inputDrc, candidateDrc }
    if (!accepted) this.hdRoutes = this.inputHdRoutes
    this.stats = {
      drcGuardedSimplificationAccepted: accepted,
      drcGuardedSimplificationInputIssueCount: inputDrc.count,
      drcGuardedSimplificationCandidateIssueCount: candidateDrc.count,
      drcGuardedSimplificationInputIssueScore: inputDrc.issueScore,
      drcGuardedSimplificationCandidateIssueScore: candidateDrc.issueScore,
      drcGuardedSimplificationInputViaCount: this.inputHdRoutes.reduce(
        (count, route) => count + route.vias.length,
        0,
      ),
      drcGuardedSimplificationCandidateViaCount: candidateHdRoutes.reduce(
        (count, route) => count + route.vias.length,
        0,
      ),
    }
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || this.failed || !this.decision) {
      throw new Error("Cannot get DRC-guarded simplification output before solve")
    }
    return this.simplifiedHdRoutes
  }
}
