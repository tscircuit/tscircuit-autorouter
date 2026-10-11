import { AutoroutingDrcEngine, type GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import type { SimplifiedPcbTraces } from "high-density-repair03/lib/types"
import type { PendingEffect } from "../../solvers/BaseSolver"
import { allocateParallelGlobalDrcId } from "./allocateParallelGlobalDrcId"
import type { Pipeline9NativeGlobalDrcContext, Pipeline9NativeGlobalDrcExceptionEvaluation, Pipeline9PreparedNativeGlobalDrcEvaluation } from "./createPreparedNativeGlobalDrcEvaluation"
import { assertParallelGlobalDrcTrialResult } from "./executeParallelGlobalDrcTrial"
import { ParallelGlobalDrcForceImproveSolver } from "./force-trial-fork/ParallelGlobalDrcForceImproveSolver"
import type { ParallelGlobalDrcTrial, ParallelGlobalDrcTrialJob, ParallelGlobalDrcTrialPlacement, ParallelGlobalDrcTrialResult } from "./parallelGlobalDrcTrialTypes"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "./repair03/Pipeline9MemoizedAutoroutingDrcEngine"

type Params = ConstructorParameters<typeof GlobalDrcForceImproveSolver>[0] & { workerPool: ParallelStageWorkerPool }
type PendingNativeEvaluation =
  | { status: "evaluated"; evaluation: Pipeline9PreparedNativeGlobalDrcEvaluation }
  | { status: "exception"; candidateKey: string; error: Error; evaluation: Pipeline9NativeGlobalDrcExceptionEvaluation }
type NativeEvaluationState = { owner?: ParallelPipeline9GlobalDrcForceImproveSolver; pending?: PendingNativeEvaluation }

/** Adoption remains inside the original snapshot's engine boundary. */
class PreparedNativeGlobalDrcEngine extends Pipeline9MemoizedAutoroutingDrcEngine {
  constructor(context: Pipeline9NativeGlobalDrcContext, private readonly state: NativeEvaluationState, params: Params) {
    super(context.srj, { ...context.engineOptions, connMap: params.connMap })
  }

  override evaluate(traces: SimplifiedPcbTraces): Pipeline9PreparedNativeGlobalDrcEvaluation["evaluatedDrc"] {
    const pending = this.state.pending
    if (!pending) return super.evaluate(traces)
    this.state.pending = undefined
    const expectedTraceKey = pending.evaluation.evaluatedTraceKey
    if (expectedTraceKey !== undefined && JSON.stringify(traces) !== expectedTraceKey) {
      throw new Error("Standalone parallel DRC adoption names different simplified trace input")
    }
    this.lastRunStats = { ...pending.evaluation.lastRunStats }
    if (pending.status === "exception") throw pending.error
    return pending.evaluation.evaluatedDrc
  }
}

/** Native standalone force policy; only independent trials move to the pool. */
export class ParallelPipeline9GlobalDrcForceImproveSolver extends ParallelGlobalDrcForceImproveSolver {
  readonly workerPool: ParallelStageWorkerPool
  pendingEffects: PendingEffect[] = []
  private launched = false
  private readonly evaluationState: NativeEvaluationState
  private readonly engineOptions: Pipeline9NativeGlobalDrcContext["engineOptions"]
  private contextKey?: string
  private contextId?: number

  constructor(params: Params) {
    if (params.drcEvaluator !== undefined || params.autoroutingDrcEngine !== undefined) {
      throw new Error("Standalone parallel DRC requires the native portable evaluator, without an explicit provider")
    }
    const state: NativeEvaluationState = {}
    const engineOptions = {
      traceClearance: params.srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.traceClearance,
      viaClearance: params.srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.viaClearance,
      includeTraceViaOwnerMetadata: params.enableTraceViaOwnerTargeting ?? false,
    }
    const engine = new PreparedNativeGlobalDrcEngine({ srj: params.srj, engineOptions }, state, params)
    super({ ...params, autoroutingDrcEngine: engine as unknown as AutoroutingDrcEngine }, {
      dispatch: (trials: ParallelGlobalDrcTrial[]): Promise<ParallelGlobalDrcTrialResult[]> => {
        if (!state.owner) throw new Error("Standalone parallel DRC coordinator was not initialized")
        return state.owner.dispatchTrials(trials)
      },
      adopt: (placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "evaluated" }>): void => {
        if (!("nativeEvaluation" in placement) || placement.nativeEvaluation.candidateKey !== JSON.stringify(placement.routes)) {
          throw new Error("Standalone parallel DRC adopted an incompatible candidate result")
        }
        state.pending = { status: "evaluated", evaluation: placement.nativeEvaluation }
      },
      adoptException: (placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "exception"; countedBeforeException: true }>, error: Error): void => {
        if (!placement.nativeExceptionEvaluation || placement.candidateKey !== JSON.stringify(placement.routes)) {
          throw new Error("Standalone parallel DRC adopted an incompatible candidate exception")
        }
        state.pending = { status: "exception", candidateKey: placement.candidateKey,
          error, evaluation: placement.nativeExceptionEvaluation }
      },
      discardPreparedEvaluation: (): void => {
        // Native snapshot-cache hits bypass engine.evaluate, so clear even an
        // unconsumed speculative success/error after every ordered adoption.
        state.pending = undefined
      },
    })
    state.owner = this
    this.workerPool = params.workerPool
    this.evaluationState = state
    this.engineOptions = engineOptions
  }

  private async dispatchTrials(trials: ParallelGlobalDrcTrial[]): Promise<ParallelGlobalDrcTrialResult[]> {
    this.evaluationState.pending = undefined
    const first = trials[0]
    if (!first) throw new Error("Standalone parallel DRC frontier contains no trials")
    const snapshotId = allocateParallelGlobalDrcId()
    const context: Pipeline9NativeGlobalDrcContext = structuredClone({ srj: this.srj,
      engineOptions: this.engineOptions, connectivity: this.connMap ? {
        connectivityNetMap: this.connMap.netMap, connectivityIdToNetMap: this.connMap.idToNetMap,
      } : undefined })
    const contextKey = JSON.stringify(context)
    if (contextKey !== this.contextKey) {
      this.contextKey = contextKey
      this.contextId = allocateParallelGlobalDrcId()
    }
    if (this.contextId === undefined) throw new Error("Standalone parallel DRC context was not assigned")
    const snapshot = { srj: first.srj, hdRoutes: first.hdRoutes, connectivity: first.connectivity }
    const jobs: ParallelGlobalDrcTrialJob[] = trials.map((trial) => {
      if (trial.srj !== snapshot.srj || trial.hdRoutes !== snapshot.hdRoutes ||
        trial.connectivity?.connectivityNetMap !== snapshot.connectivity?.connectivityNetMap ||
        trial.connectivity?.connectivityIdToNetMap !== snapshot.connectivity?.connectivityIdToNetMap) {
        throw new Error("Standalone parallel DRC frontier does not share immutable input")
      }
      const { srj, hdRoutes, connectivity, ...descriptor } = trial
      void srj
      void hdRoutes
      void connectivity
      return { kind: "globalDrcForceTrial", evaluationMode: "native", contextId: this.contextId!,
        context, snapshotId, snapshot, trial: descriptor }
    })
    const results = await Promise.all(jobs.map((job) => this.workerPool.run<ParallelGlobalDrcTrialResult>(job)))
    for (let index = 0; index < jobs.length; index++) assertParallelGlobalDrcTrialResult(jobs[index]!, results[index])
    return results
  }

  startAsyncExecution(): void {
    if (this.launched || this.solved || this.failed) return
    this.launched = true
    const promise = this.solveAsync().then((): void => {
      this.pendingEffects = []
    }, (error: unknown): never => {
      this.failed = true
      this.error = `${this.getSolverName()} error: ${error}`
      throw error
    })
    this.pendingEffects = [{ name: "parallel-standalone-global-drc-force-trials", promise }]
  }

  override async solveAsync(): Promise<void> {
    const startedAt = Date.now()
    try {
      await super.solveAsync()
    } finally {
      this.timeToSolve = Date.now() - startedAt
    }
  }

  override solve(): void {
    throw new Error("Standalone parallel DRC requires solveAsync() or awaiting pendingEffects")
  }
}
