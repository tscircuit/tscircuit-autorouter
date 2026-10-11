import { expect, test } from "bun:test"
import { installParallelIntraNodeGridKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelHighDensityGridKernel"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"

function state(solver: CachedIntraNodeRouteSolver): unknown {
  return {
    iterations: solver.iterations, max: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed, error: solver.error, progress: solver.progress,
    routes: solver.solvedRoutes, remaining: solver.unsolvedConnections,
    attempts: [...solver.rerouteAttemptsByConnection],
    cacheKey: solver.cacheKey, cacheHit: solver.cacheHit, attemptedCache: solver.hasAttemptedToUseCache,
    active: solver.activeSubSolver && {
      name: solver.activeSubSolver.getSolverName(), iterations: solver.activeSubSolver.iterations,
      max: solver.activeSubSolver.MAX_ITERATIONS, progress: solver.activeSubSolver.progress,
      solved: solver.activeSubSolver.solved, failed: solver.activeSubSolver.failed, error: solver.activeSubSolver.error,
      explored: [...solver.activeSubSolver.exploredNodes], queue: solver.activeSubSolver.candidates.getTopN(3),
    },
    failedChildren: solver.failedSubSolvers.map((child) => ({ iterations: child.iterations, error: child.error })),
  }
}

test("worker grid adapter retains native cached-node shuffle, retry, failure, and cache-hit states", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "grid-node", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -2.5, y: -2.5, z: 0 }, { connectionName: "A", x: 2.5, y: 2.5, z: 0 },
      { connectionName: "B", x: -2.5, y: 2.5, z: 0 }, { connectionName: "B", x: 2.5, y: -2.5, z: 0 },
      { connectionName: "C", x: 0, y: -2.5, z: 1 }, { connectionName: "C", x: 0, y: 2.5, z: 1 },
    ],
  }
  let found = 0
  let failed = 0
  let repaired = 0
  for (const seed of [0, 3]) {
    for (const mode of ["normal", "failed", "retry"] as const) {
      const caches = [new InMemoryCache(), new InMemoryCache()]
      const make = (index: number): CachedIntraNodeRouteSolver => {
        const solver = new CachedIntraNodeRouteSolver({
          nodeWithPortPoints: structuredClone(node), cacheProvider: caches[index], captureSearchDebug: true,
          hyperParameters: { SHUFFLE_SEED: seed },
        })
        if (index === 1) expect(installParallelIntraNodeGridKernel(solver)).toBe(solver)
        return solver
      }
      const native = make(0)
      const packed = make(1)
      if (mode === "retry") {
        const crossing: HighDensityIntraNodeRoute[] = [
          { connectionName: "A", traceThickness: 0.15, viaDiameter: 0.3,
            route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] },
          { connectionName: "B", traceThickness: 0.15, viaDiameter: 0.3,
            route: [{ x: -2, y: 0.1, z: 0 }, { x: 2, y: 0.1, z: 0 }], vias: [] },
        ]
        for (const solver of [native, packed]) {
          solver.unsolvedConnections = []
          solver.solvedRoutes = structuredClone(crossing)
        }
      }
      expect(state(packed)).toEqual(state(native))
      while (!native.solved && !native.failed) {
        native.step()
        packed.step()
        if (mode === "failed") {
          for (const solver of [native, packed]) {
            if (solver.activeSubSolver) solver.activeSubSolver.MAX_ITERATIONS = 1
          }
        }
        expect(state(packed)).toEqual(state(native))
      }
      expect(caches[1]!.cache).toEqual(caches[0]!.cache)
      found += Number(packed.solved)
      failed += Number(packed.failed)
      repaired += packed.rerouteAttemptsByConnection.size
      if (mode !== "retry") {
        const cachedNative = make(0)
        const cachedPacked = make(1)
        cachedNative.step()
        cachedPacked.step()
        expect(state(cachedPacked)).toEqual(state(cachedNative))
        expect(cachedPacked.cacheHit).toBe(true)
      }
    }
  }
  expect(found).toBeGreaterThan(0)
  expect(failed).toBeGreaterThan(0)
  expect(repaired).toBeGreaterThan(0)
})
