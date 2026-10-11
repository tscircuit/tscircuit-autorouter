import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { ParallelPathLookaheadCoordinator } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator"
import { ParallelPathLookaheadExecutor } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadExecutor"
import { captureParallelPathPrototypeContract, createParallelPathLookaheadEligibility } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { ParallelPathLookaheadResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelPathLookaheadTypes"

function makeNative(): MultiSimplifiedPathSolver {
  return new MultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: Array.from({ length: 12 }, (_, index) => ({
    connectionName: `route-${index}`, traceThickness: 0.15, viaDiameter: 0.3, vias: [],
    route: [{ x: -2, y: index * 2, z: 0 }, { x: 0, y: index * 2 + 0.4, z: 0 }, { x: 2, y: index * 2, z: 0 }],
  })) })
}

test("scoped pending windows defer unrelated future observers and rerun saved target mutations under original Native ownership", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    for (const changedIndex of [6, 10]) {
      const expected = makeNative()
      const original = makeNative()
      const eligibility = createParallelPathLookaheadEligibility(original,
        captureParallelPathPrototypeContract(MultiSimplifiedPathSolver.prototype))!
      expect(eligibility).toBeDefined()
      const executors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
      let actualReads = 0
      let expectedReads = 0
      let mutated = false
      let prefixAtMutation = -1
      const change = (native: MultiSimplifiedPathSolver, expectedSide: boolean): void => {
        const point = native.unsimplifiedHdRoutes[changedIndex]!.route[1]!
        const value = point.x
        Object.defineProperty(point, "x", { configurable: true, enumerable: true, get(): number {
          if (expectedSide) expectedReads++
          else actualReads++
          return value
        } })
      }
      const coordinator = new ParallelPathLookaheadCoordinator({ original, contextId: 410 + changedIndex,
        workerCount: 4, nativeEligibility: eligibility, nativeWorkerPool: pool,
        isEligible: eligibility, captureScope: eligibility.captureScope, captureAwaitState: eligibility.captureAwaitState,
        run: async (job): Promise<ParallelPathLookaheadResult> => {
          await Promise.resolve()
          if (job.index === 4 && !mutated) {
            mutated = true
            prefixAtMutation = original.simplifiedHdRoutes.length
            while (expected.simplifiedHdRoutes.length < prefixAtMutation) expected.step()
            change(expected, true)
            change(original, false)
          }
          const beforeClone = actualReads
          const clone = structuredClone({ ...job, cancellationBuffer: undefined })
          expect(actualReads).toBe(beforeClone)
          return executors[job.index % 4]!.execute({ ...clone, cancellationBuffer: job.cancellationBuffer })
        } })
      await coordinator.solve()
      expected.solve()
      expect(prefixAtMutation).toBe(4)
      expect(original.simplifiedHdRoutes).toEqual(expected.simplifiedHdRoutes)
      expect(original.iterations).toBe(expected.iterations)
      expect(original.currentUnsimplifiedHdRouteIndex).toBe(expected.currentUnsimplifiedHdRouteIndex)
      expect(actualReads).toBe(expectedReads)
      expect(actualReads).toBeGreaterThan(0)
      expect(coordinator.stats.certifiedRoutes).toBe(changedIndex === 6 ? 4 : 8)
      expect(coordinator.stats.awaitStateDeclines).toBe(changedIndex === 6 ? 1 : 0)
      expect(coordinator.stats.scopeCaptureDeclines).toBe(changedIndex === 6 ? 0 : 1)
      expect(eligibility.stats.scopeChecks).toBeGreaterThan(0)
    }
  } finally { pool.dispose() }
})
