import { expect, spyOn, test } from "bun:test"
import { AutoroutingDrcEngine, type SimpleRouteJson, type SimplifiedPcbTraces } from "high-density-repair03/lib"
import * as helpers from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { executeParallelGlobalDrcTrial } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeParallelGlobalDrcTrial"
import { ParallelPipeline9GlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9GlobalDrcForceImproveSolver"
import { Pipeline9MemoizedGlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9MemoizedGlobalDrcForceImproveSolver"
import type { ParallelGlobalDrcTrialJob, ParallelGlobalDrcTrialResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGlobalDrcTrialTypes"
import type { ParallelStageWorkerJob, ParallelStageWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

type NativeSolver = Pipeline9MemoizedGlobalDrcForceImproveSolver

class NativeTrialPool implements ParallelStageWorkerPool {
  readonly workerCount = 4
  readonly jobs: ParallelGlobalDrcTrialJob[] = []
  readonly results: ParallelGlobalDrcTrialResult[] = []

  async run<T>(job: ParallelStageWorkerJob): Promise<T> {
    if (job.kind !== "globalDrcForceTrial") throw new Error("Unexpected standalone fixture worker job")
    expect(job.evaluationMode).toBe("native")
    this.jobs.push(structuredClone(job))
    const result = executeParallelGlobalDrcTrial(structuredClone(job))
    this.results.push(result)
    return result as T
  }
}

function prefix(solver: NativeSolver | ParallelPipeline9GlobalDrcForceImproveSolver): unknown {
  const internal = solver as unknown as Record<string, unknown>
  const keys = ["candidateAttempts", "errorCursor", "stalledIterations", "outputSnapshot", "initialDrcIssueCount",
    "initialRepairDrcIssueCount", "initialLowCountErrorsHaveMovableTraces", "bestDrcIssueCountSeen",
    "bestDrcIssueScoreSeen", "drcCountPlateauChecks", "broadForceAccepted", "targetedForceAccepted"]
  return {
    routes: solver.getOutput(), iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed, error: solver.error, progress: solver.progress, stats: solver.stats,
    engineStats: solver.autoroutingDrcEngine!.lastRunStats,
    internal: Object.fromEntries(keys.map((key) => [key, internal[key]])),
  }
}

test("standalone parallel global force preserves native prefixes, caps, fixed preloads and exact engine metadata", async (): Promise<void> => {
  let attempted = 0
  let evaluated = 0
  let dispatched = 0
  for (const clearance of [undefined, 0.25]) {
    for (const maxIterations of [0, 1, 4]) {
      const fixture = createBoundedRegionalRepairFixture(3)
      fixture.originalSrj.obstacles = fixture.originalSrj.obstacles.map((obstacle, index) => ({
        ...obstacle, connectedTo: [...obstacle.connectedTo, `pcb_smtpad_fixture_${index}`],
      }))
      const srj: SimpleRouteJson = {
        ...fixture.originalSrj, minTraceToPadEdgeClearance: clearance,
        traces: [{ type: "pcb_trace", pcb_trace_id: "signal_0_0", connection_name: "fixed_other_net",
          route: [{ route_type: "wire", x: -3, y: 0, width: 1, layer: "top" },
            { route_type: "wire", x: 3, y: 0, width: 1, layer: "top" }] }],
      }
      const params = {
        srj, hdRoutes: fixture.routes, connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
        effort: 1, maxIterations, enableLargeBoardBroadFallback: false, enablePostSolveClearanceRelaxation: false,
      }
      const originalInputs = structuredClone({ srj, routes: fixture.routes })
      const original = new Pipeline9MemoizedGlobalDrcForceImproveSolver(params)
      const workerPool = new NativeTrialPool()
      const parallel = new ParallelPipeline9GlobalDrcForceImproveSolver({ ...params, workerPool })
      expect(parallel.drcEvaluator).toBeUndefined()
      expect(parallel.getSolverName()).toBe(original.getSolverName())
      expect(parallel.enableBroadFallback).toBe(true)
      while (!original.solved && !original.failed) {
        const applyForces = helpers.applyDrcErrorForces
        const forceHelper = clearance === undefined
          ? spyOn(helpers, "applyDrcErrorForces").mockImplementation((...args) => args[4] === 1 ? false : applyForces(...args))
          : undefined
        const iterations = parallel.iterations
        try {
          await parallel.prepareForNextStep()
          expect(parallel.iterations).toBe(iterations)
          expect(parallel.solved).toBe(false)
          expect(parallel.failed).toBe(false)
          const jobs = workerPool.jobs.length
          await parallel.prepareForNextStep()
          expect(workerPool.jobs.length).toBe(jobs)
          original.step()
          parallel.step()
          expect(prefix(parallel)).toEqual(prefix(original))
        } finally {
          forceHelper?.mockRestore()
        }
      }
      expect(parallel.solved).toBe(true)
      expect(parallel.iterations).toBeLessThanOrEqual(Math.max(1, maxIterations))
      if (clearance === undefined) expect(workerPool.jobs.length).toBeGreaterThan(0)
      dispatched += workerPool.jobs.length
      expect(workerPool.jobs.every((job) => job.trial.kind === "force-scale" && job.trial.scale !== 1)).toBe(true)
      expect({ srj, routes: fixture.routes }).toEqual(originalInputs)
      attempted += parallel.stats.globalDrcForceImproveCandidateAttempts
      for (const result of workerPool.results) {
        for (const placement of result.placements) {
          if (placement.status !== "evaluated") continue
          if (!("nativeEvaluation" in placement)) throw new Error("Standalone fixture received a Joint evaluation")
          evaluated += 1
          const evaluatedTraces = JSON.parse(placement.nativeEvaluation.evaluatedTraceKey) as SimplifiedPcbTraces
          expect(evaluatedTraces.map((trace) => trace.pcb_trace_id)).toEqual(["signal_0_0", "signal_1_0", "signal_2_0"])
          expect(evaluatedTraces.every((trace) => trace.connection_name !== "fixed_other_net")).toBe(true)
          expect(placement.nativeEvaluation.candidateKey).toBe(JSON.stringify(placement.routes))
        }
      }
      expect(() => new ParallelPipeline9GlobalDrcForceImproveSolver({ ...params, workerPool, drcEvaluator: fixture.drcEvaluator })).toThrow()
      expect(() => new ParallelPipeline9GlobalDrcForceImproveSolver({ ...params, workerPool, autoroutingDrcEngine: new AutoroutingDrcEngine(srj) })).toThrow()
    }
  }
  expect(attempted).toBeGreaterThan(0)
  expect(evaluated).toBeGreaterThan(0)
  expect(dispatched).toBeGreaterThan(0)
})
