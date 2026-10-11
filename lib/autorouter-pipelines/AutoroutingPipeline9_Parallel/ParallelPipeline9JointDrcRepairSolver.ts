import { getPendingEffectsFromSolverTree } from "../../solvers/getPendingEffectsFromSolverTree"
import { Pipeline9JointDrcRepairSolver, type Pipeline9AutoroutingDrcEngine } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { AutoroutingDrcEngine, type GlobalDrcBranchPortfolioSolver } from "high-density-repair03/lib"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "./repair03/Pipeline9MemoizedAutoroutingDrcEngine"
import { Pipeline9RegionalB01RepairSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { Pipeline9BoundedRegionalRepairSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { ParallelPipeline9RegionalB01RepairSolver } from "./ParallelPipeline9RegionalB01RepairSolver"
import { Pipeline9DenseBoundedRegionalRepairSolver } from "./Pipeline9DenseBoundedRegionalRepairSolver"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { ParallelGlobalDrcBranchPortfolioSolver } from "./force-trial-fork/ParallelGlobalDrcBranchPortfolioSolver"
import type { Pipeline9PreparedIndexedDrcEvaluation } from "./createPreparedJointDrcEvaluation"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { ParallelGlobalDrcTrial, ParallelGlobalDrcTrialJob, ParallelGlobalDrcTrialPlacement, ParallelGlobalDrcTrialResult, ParallelGlobalDrcTrialSnapshot } from "./parallelGlobalDrcTrialTypes"
import { assertParallelGlobalDrcTrialResult } from "./executeParallelGlobalDrcTrial"

let nextGlobalDrcContextId = 0
let nextGlobalDrcSnapshotId = 0

type Params = ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0] & {
  workerPool: ParallelStageWorkerPool
}

export class ParallelPipeline9JointDrcRepairSolver extends Pipeline9JointDrcRepairSolver {
  readonly workerPool: ParallelStageWorkerPool
  private preparedTrialEvaluation?: Pipeline9PreparedIndexedDrcEvaluation
  private preparedTrialException?: { candidateKey: string; error: Error }
  private globalDrcContextKey?: string
  private globalDrcContextId?: number

  constructor({ workerPool, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    this.pendingEffects = []
  }

  protected override createExactRepairSolver(
    params: ConstructorParameters<typeof GlobalDrcBranchPortfolioSolver>[0],
  ): GlobalDrcBranchPortfolioSolver {
    // The base constructor creates this child before workerPool initializes.
    // These providers resolve pool/context only when the first frontier runs.
    return new ParallelGlobalDrcBranchPortfolioSolver(params, {
      dispatch: (trials: ParallelGlobalDrcTrial[]): Promise<ParallelGlobalDrcTrialResult[]> => this.dispatchGlobalDrcTrials(trials),
      adopt: (placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "evaluated" }>): void => {
        this.preparedTrialEvaluation = placement.preparedEvaluation
        this.preparedTrialException = undefined
      },
      adoptException: (placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "exception"; countedBeforeException: true }>, error: Error): void => {
        this.preparedTrialEvaluation = undefined
        this.preparedTrialException = { candidateKey: placement.candidateKey, error }
      },
      discardPreparedEvaluation: (): void => {
        this.preparedTrialEvaluation = undefined
        this.preparedTrialException = undefined
      },
    }) as unknown as GlobalDrcBranchPortfolioSolver
  }

  protected override takePreparedIndexedDrcEvaluation(
    candidateKey: string,
    evaluatedRoutes: HighDensityRoute[],
  ): Pipeline9PreparedIndexedDrcEvaluation | undefined {
    const preparedException = this.preparedTrialException
    if (preparedException) {
      this.preparedTrialException = undefined
      if (preparedException.candidateKey !== candidateKey) {
        throw new Error("Parallel global DRC exception adoption names different route geometry")
      }
      throw preparedException.error
    }
    const prepared = this.preparedTrialEvaluation
    if (!prepared) return undefined
    if (prepared.candidateKey !== candidateKey) {
      throw new Error("Parallel global DRC trial adoption names different route geometry")
    }
    this.preparedTrialEvaluation = undefined
    this.preparedTrialException = undefined
    void evaluatedRoutes
    return prepared
  }

  private async dispatchGlobalDrcTrials(trials: ParallelGlobalDrcTrial[]): Promise<ParallelGlobalDrcTrialResult[]> {
    this.preparedTrialEvaluation = undefined
    const firstTrial = trials[0]
    if (!firstTrial) throw new Error("Parallel global DRC force frontier contains no trials")
    const snapshot: ParallelGlobalDrcTrialSnapshot = { srj: firstTrial.srj,
      hdRoutes: firstTrial.hdRoutes, connectivity: firstTrial.connectivity }
    const snapshotId = ++nextGlobalDrcSnapshotId
    const context = this.getPreparedIndexedDrcContext()
    if (!context) throw new Error("Parallel global DRC force frontier is missing its evaluation context")
    const contextKey = JSON.stringify(context)
    if (contextKey !== this.globalDrcContextKey) {
      this.globalDrcContextKey = contextKey
      this.globalDrcContextId = ++nextGlobalDrcContextId
    }
    if (this.globalDrcContextId === undefined) throw new Error("Parallel global DRC context was not assigned")
    const jobs: ParallelGlobalDrcTrialJob[] = trials.map((trial) => {
      if (trial.srj !== snapshot.srj || trial.hdRoutes !== snapshot.hdRoutes ||
        trial.connectivity?.connectivityNetMap !== snapshot.connectivity?.connectivityNetMap ||
        trial.connectivity?.connectivityIdToNetMap !== snapshot.connectivity?.connectivityIdToNetMap) {
        throw new Error("Parallel global DRC force frontier does not share an immutable input snapshot")
      }
      const { srj, hdRoutes, connectivity, ...descriptor } = trial
      void srj
      void hdRoutes
      void connectivity
      return { kind: "globalDrcForceTrial", contextId: this.globalDrcContextId!,
        context, snapshotId, snapshot, trial: descriptor }
    })
    const results = await Promise.all(jobs.map((job) => this.workerPool.run<ParallelGlobalDrcTrialResult>(job)))
    for (let index = 0; index < results.length; index++) {
      assertParallelGlobalDrcTrialResult(jobs[index]!, results[index])
    }
    return results
  }

  protected override createRegionalB01RepairSolver(
    params: ConstructorParameters<typeof Pipeline9RegionalB01RepairSolver>[0],
  ): Pipeline9RegionalB01RepairSolver {
    // The shared pool keeps ordinary routing and regional speculation within the
    // same worker limit; the joint coordinator retains all final reference checks.
    return new ParallelPipeline9RegionalB01RepairSolver({ ...params, workerPool: this.workerPool })
  }

  protected override createBoundedRegionalRepairSolver(
    params: ConstructorParameters<typeof Pipeline9BoundedRegionalRepairSolver>[0],
  ): Pipeline9BoundedRegionalRepairSolver {
    // The local implementation preserves the negotiation sequence and budgets
    // while replacing repeated exact path-search queries with dense caches.
    return new Pipeline9DenseBoundedRegionalRepairSolver(params)
  }

  protected override createAutoroutingDrcEngine(
    srj: ConstructorParameters<typeof AutoroutingDrcEngine>[0],
    options: ConstructorParameters<typeof AutoroutingDrcEngine>[1],
  ): Pipeline9AutoroutingDrcEngine {
    // Geometry keys are rebuilt from current numeric data for each evaluation;
    // reference DRC, error ownership and publication remain on the coordinator.
    return new Pipeline9MemoizedAutoroutingDrcEngine(srj, options)
  }

  override solve(): void {
    throw new Error("Parallel joint DRC repair requires solveAsync() or awaiting pendingEffects")
  }

  override _step(): void {
    const child = this.activeSubSolver
    if (child instanceof ParallelGlobalDrcBranchPortfolioSolver && !child.solved && !child.failed) {
      child.startAsyncExecution()
      return
    }
    if (child && !(child instanceof ParallelPipeline9RegionalB01RepairSolver)) {
      if (!(child instanceof ParallelGlobalDrcBranchPortfolioSolver)) child.solve()
    }
    // Keep the original coordinator's failure, publication and budget handling.
    super._step()
  }

  async solveAsync(): Promise<void> {
    const startedAt = performance.now()
    while (!this.solved && !this.failed) {
      this.step()
      const effects = getPendingEffectsFromSolverTree(this)
      if (effects.length > 0) await Promise.all(effects.map((effect) => effect.promise))
    }
    this.timeToSolve = performance.now() - startedAt
  }
}
