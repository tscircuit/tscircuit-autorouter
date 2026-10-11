import { expect, test } from "bun:test"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ParallelPathLookaheadCoordinator } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator"
import { ParallelPathLookaheadExecutor } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadExecutor"
import type { ParallelPathLookaheadJob, ParallelPathLookaheadResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelPathLookaheadTypes"
import type { HighDensityRoute } from "lib/types/high-density-types"

function makeNative(seed: number): MultiSimplifiedPathSolver {
  const routes: HighDensityRoute[] = []
  for (let index = 0; index < 12; index++) {
    const y = index * 0.33 + seed * 0.013
    routes.push({ connectionName: `route-${index}`, traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -2, y, z: index % 3 }, { x: -1, y: y + 0.43, z: index % 3 },
        { x: 1, y: y + 0.43, z: index % 3 }, { x: 2, y, z: index % 3 }],
      vias: index % 4 === 0 ? [{ x: 0.1, y: y + 0.43 }] : [] })
  }
  return new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: routes, obstacles: [], connMap: new ConnectivityMap({}) })
}

function state(solver: MultiSimplifiedPathSolver): unknown {
  return { solved: solver.solved, failed: solver.failed, error: solver.error, iterations: solver.iterations,
    progress: solver.progress, cap: solver.MAX_ITERATIONS, index: solver.currentUnsimplifiedHdRouteIndex,
    routes: solver.simplifiedHdRoutes, activeIterations: solver.activeSubSolver?.iterations,
    activeSolved: solver.activeSubSolver?.solved, activeFailed: solver.activeSubSolver?.failed }
}

test("ordered lookahead preserves native publication, full caps, deferred errors and bounded physical work", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  let certified = 0
  let reruns = 0
  for (let seed = 0; seed < 10; seed++) {
    const serial = makeNative(seed)
    serial.solve()
    for (const cap of [0, 1, 4, serial.iterations - 2, serial.iterations - 1, serial.iterations, 100_000_000]) {
      const expected = makeNative(seed)
      expected.MAX_ITERATIONS = cap
      expected.solve()
      const original = makeNative(seed)
      original.MAX_ITERATIONS = cap
      const executors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
      let active = 0
      let maximum = 0
      const coordinator = new ParallelPathLookaheadCoordinator({ original, contextId: 80 + seed, workerCount: 4,
        isEligible: (): boolean => true,
        run: async (job): Promise<ParallelPathLookaheadResult> => {
          active++
          maximum = Math.max(maximum, active)
          await Promise.resolve()
          try { return executors[job.index % 4]!.execute({ ...structuredClone({ ...job, cancellationBuffer: undefined }), cancellationBuffer: job.cancellationBuffer }) }
          finally { active-- }
        },
      })
      if (expected.failed) await expect(coordinator.solve()).rejects.toThrow("Ordered native path failed")
      else await coordinator.solve()
      expect(coordinator.native).toBe(original)
      expect(state(coordinator.native)).toEqual(state(expected))
      expect(maximum).toBeLessThanOrEqual(4)
      expect(active).toBe(0)
      expect(coordinator.stats.maximumLookahead).toBeLessThanOrEqual(4)
      expect(coordinator.stats.speculativeNativeSteps + coordinator.stats.orderedRerunNativeSteps).toBeGreaterThanOrEqual(expected.iterations - 1)
      certified += coordinator.stats.certifiedRoutes
      reruns += coordinator.stats.orderedReruns
    }
  }
  expect(certified).toBeGreaterThan(50)
  expect(reruns).toBeGreaterThan(50)

  const infrastructureFailure = new RangeError("worker transport fault")
  const coordinator = new ParallelPathLookaheadCoordinator({ original: makeNative(0), contextId: 999, workerCount: 4,
    isEligible: (): boolean => true, run: async (): Promise<ParallelPathLookaheadResult> => { throw infrastructureFailure } })
  await expect(coordinator.solve()).rejects.toBe(infrastructureFailure)
  expect(coordinator.native.iterations).toBe(0)
  expect(coordinator.stats.cancellationSignals).toBe(4)

  const invalidSource = makeNative(0)
  const invalidExecutors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
  const invalid = new ParallelPathLookaheadCoordinator({ original: invalidSource, contextId: 998, workerCount: 4,
    isEligible: (): boolean => true,
    run: async (job): Promise<ParallelPathLookaheadResult> => {
      await Promise.resolve()
      const result = invalidExecutors[job.index % 4]!.execute({ ...structuredClone({ ...job, cancellationBuffer: undefined }), cancellationBuffer: job.cancellationBuffer })
      if (job.index === 3 && result.status === "prepared") result.sourceAliases = [{ outputPath: ["route", "missing"], sourcePath: ["route", "0"] }]
      return result
    } })
  await expect(invalid.solve()).rejects.toThrow("Native source alias provenance requires existing own data properties")
  expect(invalidSource.iterations).toBe(0)
  expect(invalid.stats.certifiedRoutes).toBe(0)
  expect(invalid.stats.cancellationSignals).toBe(4)

  let eligible = true
  const executors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
  const original = makeNative(2)
  const expected = makeNative(2)
  expected.solve()
  const withdrawn = new ParallelPathLookaheadCoordinator({ original, contextId: 88, workerCount: 4,
    isEligible: (): boolean => eligible,
    run: async (job: ParallelPathLookaheadJob): Promise<ParallelPathLookaheadResult> => {
      const output = executors[job.index % 4]!.execute({ ...structuredClone({ ...job, cancellationBuffer: undefined }), cancellationBuffer: job.cancellationBuffer })
      eligible = false
      return output
    } })
  await withdrawn.solve()
  expect(state(withdrawn.native)).toEqual(state(expected))
  expect(withdrawn.stats.certifiedRoutes).toBe(0)
  expect(withdrawn.stats.eligibilityNativeRoutes).toBe(12)
  expect(withdrawn.stats.speculativeJobs).toBe(4)

  for (const replaceSource of [false, true]) {
    const original = makeNative(3)
    const expected = makeNative(3)
    const mutate = (solver: MultiSimplifiedPathSolver): void => {
      if (replaceSource) solver.unsimplifiedHdRoutes = structuredClone(solver.unsimplifiedHdRoutes)
      solver.unsimplifiedHdRoutes[1]!.route[1]!.y += 0.2
      solver.obstacles = [{ type: "rect", center: { x: 0.1, y: 0.8 }, width: 0.2, height: 0.3,
        layers: ["top"], connectedTo: [] }]
      solver.connMap = new ConnectivityMap({ joined: ["route-0", "route-1", "route-2"] })
    }
    mutate(expected)
    expected.solve()
    let eligible = true
    const executors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
    const changed = new ParallelPathLookaheadCoordinator({ original, contextId: 90, workerCount: 4,
      isEligible: (): boolean => eligible,
      run: async (job): Promise<ParallelPathLookaheadResult> => {
        const result = executors[job.index % 4]!.execute({ ...structuredClone({ ...job, cancellationBuffer: undefined }), cancellationBuffer: job.cancellationBuffer })
        if (eligible) { mutate(original); eligible = false }
        return result
      } })
    await changed.solve()
    expect(state(changed.native)).toEqual(state(expected))
    expect(changed.stats.certifiedRoutes).toBe(0)
  }
})
