import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { HighDensityRoute } from "lib/types/high-density-types"

function routes(): HighDensityRoute[] {
  return Array.from({ length: 12 }, (_, index) => ({ connectionName: `route-${index}`, traceThickness: 0.15,
    viaDiameter: 0.3, vias: [], route: [{ x: -2, y: index * 0.6, z: 0 },
      { x: 0, y: index * 0.6 + 0.4, z: 0 }, { x: 2, y: index * 0.6, z: 0 }] }))
}

function state(solver: MultiSimplifiedPathSolver): unknown {
  return { solved: solver.solved, failed: solver.failed, iterations: solver.iterations, progress: solver.progress,
    index: solver.currentUnsimplifiedHdRouteIndex, routes: solver.simplifiedHdRoutes,
    childIterations: solver.activeSubSolver?.iterations, childSolved: solver.activeSubSolver?.solved }
}

test("real four-worker withdrawal preserves original exposed child, live source/control changes and zero-read typed getters", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  for (const kind of ["hook", "source", "child", "iterations", "index", "output", "typed"] as const) {
    const expected = new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: routes(), obstacles: [] })
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
    const parallel = new ParallelMultiSimplifiedPathSolver({ unsimplifiedHdRoutes: routes(), obstacles: [],
      workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
    const floatDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Float64Array")!
    const sentinel = new RangeError("late original owner hook")
    let expectedReads = 0
    let actualReads = 0
    const mutate = (solver: MultiSimplifiedPathSolver, side: "expected" | "actual"): void => {
      if (kind === "hook") Object.defineProperty(solver, "_step", { configurable: true, get(): never {
        if (side === "expected") expectedReads++; else actualReads++
        expect(this).toBe(solver)
        throw sentinel
      } })
      if (kind === "source") {
        const source = solver.unsimplifiedHdRoutes
        Object.defineProperty(solver, "unsimplifiedHdRoutes", { configurable: true, get(): typeof source {
          if (side === "expected") expectedReads++; else actualReads++
          return source
        } })
      }
      if (kind === "child") { solver.activeSubSolver!.solved = true; solver.activeSubSolver!.newRoute = solver.activeSubSolver!.inputRoute.route }
      if (kind === "iterations") solver.iterations += 3
      if (kind === "index") solver.currentUnsimplifiedHdRouteIndex++
      if (kind === "output") solver.simplifiedHdRoutes.push(solver.unsimplifiedHdRoutes[0]!)
    }
    try {
      expected.step()
      parallel.step()
      const escapedExpected = expected.activeSubSolver!
      const escapedActual = parallel.activeSubSolver!
      const effect = parallel.pendingEffects![0]!.promise
      await Promise.resolve()
      mutate(expected, "expected")
      mutate(parallel, "actual")
      if (kind === "typed") Object.defineProperty(globalThis, "Float64Array", { configurable: true,
        get(): never { actualReads++; throw new RangeError("late typed constructor getter") } })
      let expectedError: unknown
      try { expected.solve() } catch (error: unknown) { expectedError = error }
      let actualError: unknown
      try { await effect } catch (error: unknown) { actualError = error }
      if (kind === "hook") { expect(expectedError).toBe(sentinel); expect(actualError).toBe(sentinel) }
      else { expect(expectedError).toBeUndefined(); expect(actualError).toBeUndefined() }
      expect(state(parallel)).toEqual(state(expected))
      expect(escapedActual.iterations).toBe(escapedExpected.iterations)
      expect(escapedActual.solved).toBe(escapedExpected.solved)
      expect(actualReads).toBe(expectedReads)
      expect(parallel.stats.lookaheadCertifiedRoutes).toBe(0)
      expect(parallel.stats.lookaheadSpeculativeJobs).toBe(Math.min(16, routes().length))
    } finally {
      Object.defineProperty(globalThis, "Float64Array", floatDescriptor)
      pool.dispose()
    }
  }
})
