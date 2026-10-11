import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"

test("native scope factories have private owner identity and cannot be replaced by caller getter or callback fields", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  for (const field of ["captureLookaheadScope", "captureLookaheadAwaitState"] as const) {
    for (const kind of ["getter", "callback"] as const) {
      const routes = Array.from({ length: 8 }, (_, index) => ({ connectionName: `route-${index}`, traceThickness: 0.15,
        viaDiameter: 0.3, vias: [], route: [{ x: -2, y: index * 2, z: 0 }, { x: 0, y: index * 2 + 0.4, z: 0 }, { x: 2, y: index * 2, z: 0 }] }))
      const expected = new MultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: structuredClone(routes) })
      const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
      try {
        const parallel = new ParallelMultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: routes,
          workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
        let observations = 0
        const callback = (): never => { observations++; throw new RangeError("caller scope factory observer") }
        Object.defineProperty(parallel, field, { configurable: true, enumerable: true,
          ...(kind === "getter" ? { get: callback } : { value: callback, writable: true }) })
        expected.solve()
        await parallel.solveAsync()
        expect(observations).toBe(0)
        expect(parallel.simplifiedHdRoutes).toEqual(expected.simplifiedHdRoutes)
        expect(parallel.iterations).toBe(expected.iterations)
        expect(parallel.failed).toBe(false)
        expect(pool.stats.tasksStarted).toBe(kind === "getter" ? 0 : 8)
      } finally { pool.dispose() }
    }
  }
})
