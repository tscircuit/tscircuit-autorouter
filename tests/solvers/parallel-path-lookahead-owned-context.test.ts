import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelPathLookaheadCoordinator } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator"
import { ParallelPathLookaheadExecutor } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadExecutor"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { ParallelPathLookaheadJob, ParallelPathLookaheadResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelPathLookaheadTypes"

function makeNative(): MultiSimplifiedPathSolver {
  return new MultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: Array.from({ length: 12 }, (_, index) => ({
    connectionName: `route-${index}`, traceThickness: 0.15, viaDiameter: 0.3, vias: [],
    route: [{ x: -2, y: index * 2, z: 0 }, { x: 0, y: index * 2 + 0.4, z: 0 }, { x: 2, y: index * 2, z: 0 }],
  })) })
}

test("deferred worker serializers read only owned context and prefix graphs after caller source mutation", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const expected = makeNative()
  const original = makeNative()
  let expectedReads = 0
  let actualReads = 0
  let nativeAllowed = true
  let mutated = false
  const jobs: ParallelPathLookaheadJob[] = []
  const executors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
  const mutate = (native: MultiSimplifiedPathSolver, expectedSide: boolean): void => {
    const point = native.unsimplifiedHdRoutes[10]!.route[1]!
    const value = point.x
    Object.defineProperty(point, "x", { enumerable: true, configurable: true, get(): number {
      if (expectedSide) expectedReads++
      else actualReads++
      return value
    } })
  }
  const coordinator = new ParallelPathLookaheadCoordinator({ original, contextId: 301, workerCount: 4,
    isEligible: (): boolean => nativeAllowed,
    run: async (job): Promise<ParallelPathLookaheadResult> => {
      jobs.push(job)
      await Promise.resolve()
      if (!mutated) {
        mutated = true
        mutate(expected, true)
        mutate(original, false)
        nativeAllowed = false
      }
      const encoded = structuredClone({ ...job, cancellationBuffer: undefined })
      expect(actualReads).toBe(0)
      return executors[job.index % 4]!.execute({ ...encoded, cancellationBuffer: job.cancellationBuffer })
    } })
  expected.step()
  original.step()
  await coordinator.solve()
  expected.solve()
  expect(actualReads).toBe(expectedReads)
  expect(actualReads).toBeGreaterThan(0)
  expect(original.simplifiedHdRoutes).toEqual(expected.simplifiedHdRoutes)
  expect(original.iterations).toBe(expected.iterations)
  expect(jobs.length).toBe(4)
  expect(jobs[0]!.context!.params.unsimplifiedHdRoutes).not.toBe(original.unsimplifiedHdRoutes)
  expect(jobs[0]!.context!.params.unsimplifiedHdRoutes[10]!.route[1]).not.toBe(original.unsimplifiedHdRoutes[10]!.route[1])

  const prefixOwner = makeNative()
  let prefixChecked = false
  const prefixExecutors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
  const prefixCoordinator = new ParallelPathLookaheadCoordinator({ original: prefixOwner, contextId: 302,
    workerCount: 4, isEligible: (): boolean => true,
    run: async (job): Promise<ParallelPathLookaheadResult> => {
      if (job.updates.length) {
        prefixChecked = true
        expect(job.updates[0]!.route).not.toBe(prefixOwner.simplifiedHdRoutes[0])
        expect(job.updates[0]!.route.route[0]).not.toBe(prefixOwner.simplifiedHdRoutes[0]!.route[0])
        expect(job.updates[0]!.route).toEqual(prefixOwner.simplifiedHdRoutes[0])
      }
      await Promise.resolve()
      return prefixExecutors[job.index % 4]!.execute({ ...structuredClone({ ...job, cancellationBuffer: undefined }),
        cancellationBuffer: job.cancellationBuffer })
    } })
  await prefixCoordinator.solve()
  expect(prefixChecked).toBe(true)
  expect(prefixCoordinator.stats.certifiedRoutes).toBe(12)
})
