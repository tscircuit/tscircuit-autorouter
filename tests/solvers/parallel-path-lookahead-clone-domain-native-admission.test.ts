import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("uncloneable own descriptors and symbols retain actual native fields and source aliases before worker admission", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  for (const kind of ["route", "point", "symbol"] as const) {
    const makeRoutes = (): HighDensityRoute[] => Array.from({ length: 8 }, (_, index) => {
      const route: HighDensityRoute = { connectionName: `route-${index}`, traceThickness: 0.15, viaDiameter: 0.3,
        vias: [], route: [{ x: -2, y: index * 2, z: 0 }, { x: 0, y: index * 2 + 0.4, z: 0 }, { x: 2, y: index * 2, z: 0 }] }
      if (kind === "route") Object.defineProperty(route, "jumpers", { value: [], configurable: true, writable: true })
      if (kind === "point") Object.defineProperty(route.route[0]!, "nativeMetadata", { value: index, configurable: true, writable: true })
      if (kind === "symbol") Object.defineProperty(route.route[0]!, Symbol.for("native-source-metadata"), {
        value: index, configurable: true, writable: true, enumerable: true })
      return route
    })
    const expected = new MultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: makeRoutes() })
    const sources = makeRoutes()
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
    try {
      const parallel = new ParallelMultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: sources,
        workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
      expected.solve()
      parallel.solve()
      expect(parallel.simplifiedHdRoutes).toEqual(expected.simplifiedHdRoutes)
      expect(parallel.iterations).toBe(expected.iterations)
      expect(pool.stats.tasksStarted).toBe(0)
      for (let index = 0; index < sources.length; index++) {
        expect(parallel.simplifiedHdRoutes[index]!.route[0]).toBe(sources[index]!.route[0])
        expect(Object.getOwnPropertyDescriptors(parallel.simplifiedHdRoutes[index]!.route[0]!))
          .toEqual(Object.getOwnPropertyDescriptors(expected.simplifiedHdRoutes[index]!.route[0]!))
        if (kind === "route") expect(parallel.simplifiedHdRoutes[index]!.jumpers).toBe(sources[index]!.jumpers)
      }
    } finally { pool.dispose() }
  }
})
