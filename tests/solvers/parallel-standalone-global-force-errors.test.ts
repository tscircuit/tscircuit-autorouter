import { expect, spyOn, test } from "bun:test"
import type { SimpleRouteJson } from "high-density-repair03/lib"
import { executeParallelGlobalDrcTrial } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeParallelGlobalDrcTrial"
import { ParallelPipeline9GlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9GlobalDrcForceImproveSolver"
import { Pipeline9MemoizedGlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9MemoizedGlobalDrcForceImproveSolver"
import type { ParallelGlobalDrcTrialJob, ParallelGlobalDrcTrialPlacement } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGlobalDrcTrialTypes"
import type { ParallelStageWorkerJob, ParallelStageWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

type Solver = Pipeline9MemoizedGlobalDrcForceImproveSolver | ParallelPipeline9GlobalDrcForceImproveSolver

type FixtureParams = ConstructorParameters<typeof Pipeline9MemoizedGlobalDrcForceImproveSolver>[0]

class FailingNativeTrialPool implements ParallelStageWorkerPool {
  readonly workerCount = 4
  readonly jobs: ParallelGlobalDrcTrialJob[] = []
  injected = false

  constructor(private readonly error: Error, private readonly failDispatch: boolean, private readonly exceptionStats?: NonNullable<Solver["autoroutingDrcEngine"]>["lastRunStats"]) {
    this.injected = false
    this.jobs = []
    expect(error).toBeInstanceOf(Error)
  }

  async run<T>(job: ParallelStageWorkerJob): Promise<T> {
    if (job.kind !== "globalDrcForceTrial") throw new Error("Unexpected standalone error fixture job")
    this.jobs.push(structuredClone(job))
    if (this.failDispatch) throw this.error
    const result = executeParallelGlobalDrcTrial(structuredClone(job))
    if (!this.injected) {
      result.placements = result.placements.map((placement): ParallelGlobalDrcTrialPlacement => {
        if (this.injected || placement.status !== "evaluated") return placement
        this.injected = true
        if (!("nativeEvaluation" in placement)) throw new Error("Expected native worker evaluation metadata")
        return { status: "exception", countedBeforeException: true, routes: placement.routes,
          candidateKey: JSON.stringify(placement.routes),
          nativeExceptionEvaluation: { evaluatedTraceKey: placement.nativeEvaluation.evaluatedTraceKey,
            lastRunStats: this.exceptionStats ?? placement.nativeEvaluation.lastRunStats },
          exception: { name: this.error.name, message: this.error.message, stack: this.error.stack } }
      })
    }
    return result as T
  }
}

function createParams(): FixtureParams {
  const fixture = createBoundedRegionalRepairFixture(3)
  fixture.originalSrj.obstacles = fixture.originalSrj.obstacles.map((obstacle, index) => ({
    ...obstacle, connectedTo: [...obstacle.connectedTo, `pcb_smtpad_fixture_${index}`],
  }))
  return {
    srj: fixture.originalSrj as SimpleRouteJson, hdRoutes: fixture.routes,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj), effort: 1, maxIterations: 1,
    enableLargeBoardBroadFallback: false, enablePostSolveClearanceRelaxation: false,
  }
}

function stepException(solver: Solver): unknown {
  try {
    solver.step()
  } catch (error: unknown) {
    return error
  }
  throw new Error("Expected standalone native Base.step to throw")
}

function exceptionPrefix(solver: Solver): unknown {
  const internal = solver as unknown as Record<string, unknown>
  const keys = ["candidateAttempts", "errorCursor", "initialDrcIssueCount", "initialRepairDrcIssueCount",
    "initialLowCountErrorsHaveMovableTraces", "bestDrcIssueCountSeen", "bestDrcIssueScoreSeen", "outputSnapshot"]
  return {
    iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS, solved: solver.solved,
    failed: solver.failed, error: solver.error, progress: solver.progress, stats: solver.stats,
    engineStats: solver.autoroutingDrcEngine!.lastRunStats, routes: solver.getOutput(),
    internal: Object.fromEntries(keys.map((key) => [key, internal[key]])),
  }
}

function rejectFirstChangedEvaluation(solver: Solver, laterError?: Error): { restore(): void; changedCalls(): number } {
  const engine = solver.autoroutingDrcEngine!
  const evaluate = engine.evaluate.bind(engine)
  let firstTraceKey: string | undefined
  let baseline: ReturnType<typeof evaluate> | undefined
  let changed = 0
  const mock = spyOn(engine, "evaluate").mockImplementation((traces) => {
    const key = JSON.stringify(traces)
    firstTraceKey ??= key
    if (key === firstTraceKey) {
      baseline = evaluate(traces)
      return baseline
    }
    changed += 1
    if (changed === 1) {
      if (!baseline) throw new Error("Missing native baseline evaluation")
      return baseline
    }
    if (laterError) throw laterError
    return evaluate(traces)
  })
  return { restore: (): void => mock.mockRestore(), changedCalls: (): number => changed }
}

test("standalone global force consumes typed worker errors at native Base.step and retains direct dispatcher identity", async (): Promise<void> => {
  const params = createParams()
  const nativeError = new RangeError("native raw evaluator failure")
  const original = new Pipeline9MemoizedGlobalDrcForceImproveSolver(params)
  const engine = original.autoroutingDrcEngine!
  const evaluateSpy = rejectFirstChangedEvaluation(original, nativeError)
  const nativeAcceptance = spyOn(original, "tryFinalAcceptance")
  try {
    expect(stepException(original)).toBe(nativeError)
    expect(evaluateSpy.changedCalls()).toBe(2)
    expect(nativeAcceptance).toHaveBeenCalledTimes(0)
  } finally {
    evaluateSpy.restore()
    nativeAcceptance.mockRestore()
  }
  const workerPool = new FailingNativeTrialPool(nativeError, false, { ...engine.lastRunStats })
  const parallel = new ParallelPipeline9GlobalDrcForceImproveSolver({ ...params, workerPool })
  const acceptance = spyOn(parallel, "tryFinalAcceptance")
  const parallelEvaluation = rejectFirstChangedEvaluation(parallel)
  try {
    await parallel.prepareForNextStep()
    expect(workerPool.injected).toBe(true)
    expect(parallel.iterations).toBe(0)
    expect(parallel.failed).toBe(false)
    expect(parallel.error).toBeNull()
    expect(acceptance).toHaveBeenCalledTimes(0)
    const jobCount = workerPool.jobs.length
    await parallel.prepareForNextStep()
    expect(workerPool.jobs.length).toBe(jobCount)
    const selected = stepException(parallel)
    expect(selected).toBeInstanceOf(RangeError)
    expect((selected as Error).message).toBe(nativeError.message)
    expect((selected as Error).stack).toBe(nativeError.stack)
    expect(exceptionPrefix(parallel)).toEqual(exceptionPrefix(original))
    expect((parallel as unknown as { candidateAttempts: number }).candidateAttempts).toBe(2)
    expect(parallelEvaluation.changedCalls()).toBe(2)
    expect(workerPool.jobs.map((job) => job.trial.kind === "force-scale" ? job.trial.scale : undefined)).toEqual([1.75, -1])
    expect(acceptance).toHaveBeenCalledTimes(0)
  } finally {
    parallelEvaluation.restore()
    acceptance.mockRestore()
  }

  const dispatchError = new TypeError("native dispatch error identity")
  const dispatchPool = new FailingNativeTrialPool(dispatchError, true)
  const dispatchSolver = new ParallelPipeline9GlobalDrcForceImproveSolver({ ...params, workerPool: dispatchPool })
  const dispatchEvaluation = rejectFirstChangedEvaluation(dispatchSolver)
  try {
    await dispatchSolver.prepareForNextStep()
  } finally {
    dispatchEvaluation.restore()
  }
  expect(dispatchSolver.failed).toBe(false)
  expect(dispatchSolver.iterations).toBe(0)
  expect((dispatchSolver as unknown as { candidateAttempts: number }).candidateAttempts).toBe(1)
  expect(stepException(dispatchSolver)).toBe(dispatchError)
  expect(dispatchSolver.iterations).toBe(1)
  expect(dispatchSolver.failed).toBe(true)
  expect(dispatchSolver.solved).toBe(false)
  expect(dispatchSolver.error).toBe("GlobalDrcForceImproveSolver error: TypeError: native dispatch error identity")
})
