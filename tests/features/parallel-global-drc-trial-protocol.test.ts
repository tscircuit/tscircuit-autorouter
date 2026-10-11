import { expect, test } from "bun:test"
import type { ParallelGlobalDrcTrialJob, ParallelGlobalDrcTrialResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGlobalDrcTrialTypes"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createParallelGlobalDrcFixture } from "../fixtures/parallel-global-drc-fixture"

class ContextJoint extends Pipeline9JointDrcRepairSolver {
  makeJob(kind: "force-scale" | "safe-trace-layer", evaluationMode: "joint" | "native"): ParallelGlobalDrcTrialJob {
    const context = this.getPreparedIndexedDrcContext()
    if (!context) throw new Error("Global force protocol fixture has no evaluation context")
    const snapshot = { srj: context.engineSrj, hdRoutes: this.exactRepairSolver!.params.hdRoutes }
    const common = { trialIndex: 0, error: { type: "pcb_trace_error" } }
    const trial = kind === "force-scale" ? { ...common, kind, traceRouteIndexById: new Map<string, number>(),
      scale: 1, enableTargetedErrorSweep: false, canMoveSharedViaSiteWithoutTradingDrcErrors: false,
      enableTraceViaOwnerTargeting: true } : { ...common, kind, changedRouteIndex: 0,
      targetZ: 1, spanExpansion: 0, directionVariant: 0 }
    const commonJob = { kind: "globalDrcForceTrial" as const, contextId: 1, snapshotId: 1, snapshot, trial }
    return evaluationMode === "joint" ? { ...commonJob, evaluationMode, context }
      : { ...commonJob, evaluationMode, context: { srj: context.engineSrj, engineOptions: context.engineOptions } }
  }
}

class ControlledWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: Pipeline9LocalWorkerRequest[] = []
  terminated = false
  postMessage(request: Pipeline9LocalWorkerRequest): void {
    this.requests.push(request)
  }
  terminate(): void {
    this.terminated = true
  }
  deliver(result: unknown, requestIndex = 0): void {
    const request = this.requests[requestIndex]
    if (!request || !this.onmessage) throw new Error("Controlled global force worker has no pending request")
    this.onmessage({ data: { taskId: request.taskId, ok: true, result } } as MessageEvent<Pipeline9LocalWorkerResponse>)
  }
}

function createControlledPool(): { pool: Pipeline9LocalWorkerPool; workers: ControlledWorker[] } {
  const workers: ControlledWorker[] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 2, workerFactory: (): Worker => {
    const worker = new ControlledWorker()
    workers.push(worker)
    return worker as unknown as Worker
  } })
  return { pool, workers }
}

test("real pool rejects malformed unused force trials globally but preserves typed speculative errors", async (): Promise<void> => {
  const fixture = new ContextJoint(createParallelGlobalDrcFixture(false))
  for (const evaluationMode of ["joint", "native"] as const) {
  for (const kind of ["force-scale", "safe-trace-layer"] as const) {
    const job = fixture.makeJob(kind, evaluationMode)
    const valid: ParallelGlobalDrcTrialResult = { kind: "globalDrcForceTrial", trialIndex: 0,
      placements: kind === "force-scale" ? [{ status: "unchanged" }] : [{ status: "unchanged" }, { status: "unchanged" }] }
    const evaluated = { status: "evaluated" as const, routes: [], preparedEvaluation: {
      candidateKey: "[]", evaluatedDrc: { errors: [], errorsWithCenters: [] },
      preparedCandidateDrcInput: { evaluatedTraces: [], routedTraces: [],
        movableTraceIds: new Set<string>(), originalTraceIdByEvaluationTraceId: new Map<string, string>(),
        solverTraceIdByEvaluationTraceId: new Map<string, string>() } } }
    const lastRunStats = { traceCount: 0, segmentCount: 0, viaCount: 0, obstacleCount: 0,
      broadPhaseCandidateCount: 0, exactCheckCount: 0 }
    const nativeEvaluated = { status: "evaluated" as const, routes: [], nativeEvaluation: {
      candidateKey: "[]", evaluatedTraceKey: "[]", lastRunStats, evaluatedDrc: { errors: [], errorsWithCenters: [] } } }
    const malformed: unknown[] = [
      { ...valid, kind: "different" },
      { ...valid, trialIndex: 1 },
      { ...valid, placements: [] },
      { ...valid, placements: [{ status: "unexplained" }] },
      { ...valid, placements: [{ status: "exception", exception: { name: "Error", message: "bad" } }] },
      { ...valid, placements: kind === "force-scale"
        ? [{ status: "exception", countedBeforeException: true, exception: { name: "Error", message: "bad" } }]
        : [{ status: "exception", countedBeforeException: true, exception: { name: "Error", message: "bad" } }, { status: "unchanged" }] },
      { ...valid, placements: kind === "force-scale"
        ? [{ status: "evaluated", routes: [], preparedEvaluation: {} }]
        : [{ status: "unchanged" }, { status: "evaluated", routes: [], preparedEvaluation: {} }] },
    ]
    for (const field of ["routedTraces", "movableTraceIds", "originalTraceIdByEvaluationTraceId", "solverTraceIdByEvaluationTraceId"]) {
      const preparedCandidateDrcInput: Record<string, unknown> = { ...evaluated.preparedEvaluation.preparedCandidateDrcInput }
      delete preparedCandidateDrcInput[field]
      const malformedEvaluated = { ...evaluated, preparedEvaluation: {
        ...evaluated.preparedEvaluation, preparedCandidateDrcInput } }
      malformed.push({ ...valid, placements: kind === "force-scale" ? [malformedEvaluated]
        : [{ status: "unchanged" }, malformedEvaluated] })
    }
    for (const field of ["candidateKey", "evaluatedTraceKey", "lastRunStats", "evaluatedDrc"]) {
      const nativeEvaluation: Record<string, unknown> = { ...nativeEvaluated.nativeEvaluation }
      delete nativeEvaluation[field]
      const malformedEvaluated = { ...nativeEvaluated, nativeEvaluation }
      malformed.push({ ...valid, placements: kind === "force-scale" ? [malformedEvaluated]
        : [{ status: "unchanged" }, malformedEvaluated] })
    }
    for (const response of malformed) {
      const { pool, workers } = createControlledPool()
      const pending = [pool.run(job), pool.run(job), pool.run(job)]
      const settled = Promise.allSettled(pending)
      expect(workers).toHaveLength(2)
      workers[0]!.deliver(response)
      const results = await settled
      expect(results.every((result) => result.status === "rejected")).toBe(true)
      const error = (results[0] as PromiseRejectedResult).reason
      expect(error).toBeInstanceOf(Error)
      for (const result of results) expect((result as PromiseRejectedResult).reason).toBe(error)
      expect(workers.every((worker) => worker.terminated)).toBe(true)
      expect(pool.stats.tasksCompleted).toBe(0)
      await expect(pool.run(job)).rejects.toBe(error)
    }
    const { pool, workers } = createControlledPool()
    try {
      const pending = [pool.run<ParallelGlobalDrcTrialResult>(job), pool.run<ParallelGlobalDrcTrialResult>(job)]
      const typed: ParallelGlobalDrcTrialResult = { kind: "globalDrcForceTrial", trialIndex: 0,
        placements: kind === "force-scale"
          ? [{ status: "exception", countedBeforeException: true, routes: [], candidateKey: "[]",
            exception: { name: "TypeError", message: "unused speculative trial" },
            ...(evaluationMode === "native" ? { nativeExceptionEvaluation: { evaluatedTraceKey: "[]", lastRunStats } } : {}) }]
          : [{ status: "exception", countedBeforeException: true, routes: [], candidateKey: "[]",
            exception: { name: "TypeError", message: "unused speculative trial" },
            ...(evaluationMode === "native" ? { nativeExceptionEvaluation: { evaluatedTraceKey: "[]", lastRunStats } } : {}) }, { status: "unchanged" }] }
      workers[0]!.deliver(typed)
      workers[1]!.deliver(valid)
      expect(await pending[0]).toEqual(typed)
      expect(await pending[1]).toEqual(valid)
      expect(workers.every((worker) => !worker.terminated)).toBe(true)
      const next = pool.run<ParallelGlobalDrcTrialResult>(job)
      workers[0]!.deliver(valid, 1)
      expect(await next).toEqual(valid)
      expect(pool.stats.tasksCompleted).toBe(3)
      expect(pool.stats.maxActiveWorkers).toBe(2)
    } finally {
      pool.dispose()
    }
  }
  }
})
