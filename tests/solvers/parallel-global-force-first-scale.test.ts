import { expect, spyOn, test } from "bun:test"
import { GlobalDrcForceImproveSolver, type DrcEvaluator, type SimpleRouteJson } from "high-density-repair03/lib"
import * as helpers from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { ParallelGlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-trial-fork/ParallelGlobalDrcForceImproveSolver"
import type { ParallelGlobalDrcTrial, ParallelGlobalDrcTrialCoordinator, ParallelGlobalDrcTrialPlacement, ParallelGlobalDrcTrialResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGlobalDrcTrialTypes"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

type Solver = GlobalDrcForceImproveSolver | ParallelGlobalDrcForceImproveSolver
type Mode = "accepted" | "cached" | "helper-error" | "raw-error"
const initialError = { type: "pcb_trace_error", pcb_trace_id: "signal_0", center: { x: 0, y: 0 }, message: "first-scale collision" }

class ForbiddenCoordinator implements ParallelGlobalDrcTrialCoordinator {
  readonly batches: ParallelGlobalDrcTrial[][] = []
  adoptions = 0

  async dispatch(trials: ParallelGlobalDrcTrial[]): Promise<ParallelGlobalDrcTrialResult[]> {
    this.batches.push(trials)
    expect(trials.length).toBeGreaterThan(0)
    const scales = trials.map((trial) => trial.kind === "force-scale" ? trial.scale : trial.kind)
    const detail = JSON.stringify(scales)
    throw new Error(`First-scale result should prevent worker dispatch: ${detail}`)
  }

  adopt(placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "evaluated" }>): void {
    this.adoptions += 1
    expect(placement.status).toBe("evaluated")
    expect(placement.routes.length).toBeGreaterThan(0)
    const detail = JSON.stringify(placement.routes)
    throw new Error(`First scale should use the original evaluator: ${detail}`)
  }

  adoptException(placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "exception"; countedBeforeException: true }>, error: Error): void {
    this.adoptions += 1
    expect(placement.countedBeforeException).toBe(true)
    expect(error).toBeInstanceOf(Error)
    const detail = placement.candidateKey
    throw new Error(`First-scale exceptions should preserve the original object: ${detail}`)
  }
}

function nativePrefix(solver: Solver): unknown {
  const internal = solver as unknown as Record<string, unknown>
  const keys = ["candidateAttempts", "errorCursor", "stalledIterations", "outputSnapshot", "initialDrcIssueCount",
    "initialRepairDrcIssueCount", "initialLowCountErrorsHaveMovableTraces", "bestDrcIssueCountSeen", "bestDrcIssueScoreSeen"]
  return {
    routes: solver.getOutput(), iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed, error: solver.error, progress: solver.progress, stats: solver.stats,
    internal: Object.fromEntries(keys.map((key) => [key, internal[key]])),
  }
}

function consumeStep(solver: Solver): unknown {
  try {
    solver.step()
    return undefined
  } catch (error: unknown) {
    return error
  }
}

test("first native force acceptance and cache hits dispatch zero jobs and retain first-error identity", async (): Promise<void> => {
  for (const mode of ["accepted", "cached", "helper-error", "raw-error"] as Mode[]) {
    const fixture = createBoundedRegionalRepairFixture()
    const originalInputs = structuredClone(fixture.routes)
    const inputKey = JSON.stringify(helpers.materializeRoutes(helpers.cloneRoutes(fixture.routes)))
    const candidate = helpers.cloneRoutes(fixture.routes)
    candidate[0]!.route[1]!.y += 0.25
    const candidateKey = JSON.stringify(helpers.materializeRoutes(candidate))
    const selectedError = new RangeError(`first ${mode}`)
    const cachedResults = new Map<string, ReturnType<DrcEvaluator>>([[candidateKey, []]])
    let cacheHits = 0
    let rawCalls = 0
    const evaluator: DrcEvaluator = ({ routes }) => {
      const key = JSON.stringify(routes)
      if (key === inputKey) return [initialError]
      if (mode === "cached") {
        const cached = cachedResults.get(key)
        if (cached !== undefined) {
          cacheHits += 1
          return cached
        }
        throw new Error("The first force candidate missed its prepared raw DRC cache")
      }
      rawCalls += 1
      if (mode === "raw-error") throw selectedError
      return []
    }
    const params = {
      srj: fixture.originalSrj as SimpleRouteJson, hdRoutes: fixture.routes,
      drcEvaluator: evaluator, effort: 1, maxIterations: 1,
      enableBroadFallback: false, enableLargeBoardBroadFallback: false, enablePostSolveClearanceRelaxation: false,
    }
    const coordinator = new ForbiddenCoordinator()
    const original = new GlobalDrcForceImproveSolver(params)
    const parallel = new ParallelGlobalDrcForceImproveSolver(params, coordinator)
    const scales: number[] = []
    const forceHelper = spyOn(helpers, "applyDrcErrorForces").mockImplementation((_srj, routes, _errors, _map, scale) => {
      scales.push(scale)
      if (mode === "helper-error") throw selectedError
      routes[0]!.route[1]!.y += 0.25
      return true
    })
    try {
      const originalError = consumeStep(original)
      await parallel.prepareForNextStep()
      expect(parallel.iterations).toBe(0)
      expect(parallel.solved).toBe(false)
      expect(parallel.failed).toBe(false)
      const calls = scales.length
      await parallel.prepareForNextStep()
      expect(scales.length).toBe(calls)
      const parallelError = consumeStep(parallel)
      if (mode === "helper-error" || mode === "raw-error") {
        expect(originalError).toBe(selectedError)
        expect(parallelError).toBe(selectedError)
        expect(parallel.failed).toBe(true)
      } else {
        expect(originalError).toBeUndefined()
        expect(parallelError).toBeUndefined()
        expect(parallel.solved).toBe(true)
      }
      expect(nativePrefix(parallel)).toEqual(nativePrefix(original))
      expect(scales).toEqual([1, 1])
      expect(coordinator.batches).toHaveLength(0)
      expect(coordinator.adoptions).toBe(0)
      expect(fixture.routes).toEqual(originalInputs)
      expect((parallel as unknown as { candidateAttempts: number }).candidateAttempts).toBe(mode === "helper-error" ? 0 : 1)
      if (mode === "cached") {
        expect(cacheHits).toBe(2)
        expect(rawCalls).toBe(0)
      }
    } finally {
      forceHelper.mockRestore()
    }
  }
})
