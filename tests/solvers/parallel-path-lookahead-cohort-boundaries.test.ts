import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { captureParallelPathPrototypeContract, createParallelPathLookaheadEligibility } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import { createNativeParallelPathLookaheadRun, ParallelPathLookaheadCoordinator } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { HighDensityRoute } from "lib/types/high-density-types"

const contract = captureParallelPathPrototypeContract(MultiSimplifiedPathSolver.prototype)

function makeOwner(shared: boolean): MultiSimplifiedPathSolver {
  const metadata = { value: 19, nested: { label: "shared Native endpoint metadata" } }
  const routes: HighDensityRoute[] = Array.from({ length: 130 }, (_, index) => {
    const y = index * 0.8
    return { connectionName: `cohort-${index}`, traceThickness: 0.15, viaDiameter: 0.3, vias: [],
      route: [{ x: -2, y, z: 0, metadata }, { x: 0, y: y + 0.3, z: 0 }, { x: 2, y, z: 0 }] }
  })
  if (shared) {
    routes[64]!.route[0] = routes[0]!.route[0]!
    routes[65]!.route[0] = routes[1]!.route[0]!
  }
  return new MultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: routes })
}

function state(owner: MultiSimplifiedPathSolver): unknown {
  return { routes: owner.simplifiedHdRoutes, iterations: owner.iterations, cap: owner.MAX_ITERATIONS,
    index: owner.currentUnsimplifiedHdRouteIndex, solved: owner.solved, failed: owner.failed,
    error: owner.error, progress: owner.progress, childIterations: owner.activeSubSolver?.iterations,
    childSolved: owner.activeSubSolver?.solved }
}

test("private cohorts preserve cross-route aliases, a short final cohort, and live cap/source/index withdrawal after the first cohort", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  for (const kind of ["aliases", "cap", "source", "index"] as const) {
    const expected = makeOwner(kind === "aliases")
    const actual = makeOwner(kind === "aliases")
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport: "bun-shared" })
    try {
      const helper = createParallelPathLookaheadEligibility(actual, contract)!
      expect(helper()).toBe(true)
      const coordinator = new ParallelPathLookaheadCoordinator({ original: actual, workerCount: 4,
        contextId: pool.createContextId(), run: createNativeParallelPathLookaheadRun(actual, helper, pool)!,
        nativeEligibility: helper, nativeWorkerPool: pool, isEligible: helper,
        captureScope: helper.captureScope, captureAwaitState: helper.captureAwaitState })
      const solving = coordinator.solve()
      let boundarySeen = false
      if (kind !== "aliases") {
        while (expected.simplifiedHdRoutes.length < 64) expected.step()
        while (actual.simplifiedHdRoutes.length < 64 && !actual.solved && !actual.failed) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        expect(actual.simplifiedHdRoutes.length).toBe(64)
        boundarySeen = true
        if (kind === "cap") actual.MAX_ITERATIONS = expected.MAX_ITERATIONS = expected.iterations + 2
        if (kind === "source") {
          actual.unsimplifiedHdRoutes[65]!.route[0]!.x -= 0.15
          expected.unsimplifiedHdRoutes[65]!.route[0]!.x -= 0.15
        }
        if (kind === "index") {
          actual.currentUnsimplifiedHdRouteIndex++
          expected.currentUnsimplifiedHdRouteIndex++
        }
      }
      expected.solve()
      if (kind === "cap") await expect(solving).rejects.toThrow("Ordered native path failed")
      else await solving
      expect(state(actual)).toEqual(state(expected))
      expect(pool.stats.maxActiveWorkers).toBe(4)
      expect(pool.stats.tasksCompleted).toBe(pool.stats.tasksStarted)
      if (kind === "aliases") {
        expect(coordinator.stats.prefixCloneCalls).toBe(3)
        expect(coordinator.stats.prefixRowsCloned).toBe(192)
        expect(coordinator.stats.speculativeJobs).toBe(130)
        for (let index = 0; index < actual.simplifiedHdRoutes.length; index++) {
          expect(actual.simplifiedHdRoutes[index]!.route[0]).toBe(actual.unsimplifiedHdRoutes[index]!.route[0])
          const point = actual.simplifiedHdRoutes[index]!.route[0]! as HighDensityRoute["route"][number] & { metadata: unknown }
          const source = actual.unsimplifiedHdRoutes[0]!.route[0]! as typeof point
          expect(point.metadata).toBe(source.metadata)
        }
        expect(actual.simplifiedHdRoutes[64]!.route[0]).toBe(actual.simplifiedHdRoutes[0]!.route[0])
        expect(actual.simplifiedHdRoutes[65]!.route[0]).toBe(actual.simplifiedHdRoutes[1]!.route[0])
      } else {
        expect(boundarySeen).toBe(true)
        expect(coordinator.stats.awaitStateDeclines).toBe(1)
        expect(coordinator.stats.speculativeJobs).toBe(128)
        expect(coordinator.stats.cancellationSignals).toBe(64)
      }
    } finally { pool.dispose() }
  }
})
