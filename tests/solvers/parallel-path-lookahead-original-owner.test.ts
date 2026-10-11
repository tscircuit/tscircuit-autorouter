import { expect, test } from "bun:test"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelPathLookaheadCoordinator } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator"
import { ParallelPathLookaheadExecutor } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadExecutor"
import type { ParallelPathLookaheadResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelPathLookaheadTypes"

function makeNative(): MultiSimplifiedPathSolver {
  return new MultiSimplifiedPathSolver({ obstacles: [], unsimplifiedHdRoutes: Array.from({ length: 9 }, (_, index) => ({
    connectionName: `route-${index}`, traceThickness: 0.15, viaDiameter: 0.3, vias: [],
    route: [{ x: -2, y: index * 0.8, z: 0 }, { x: 0, y: index * 0.8 + 0.3, z: 0 }, { x: 2, y: index * 0.8, z: 0 }],
  })) })
}

function state(native: MultiSimplifiedPathSolver): unknown {
  return { solved: native.solved, failed: native.failed, error: native.error, iterations: native.iterations,
    progress: native.progress, index: native.currentUnsimplifiedHdRouteIndex,
    routes: native.simplifiedHdRoutes, active: native.activeSubSolver?.iterations }
}

test("lookahead withdrawal continues the actual owner with original hook, source getter, cap and exposed-child observations", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  for (const initialChild of [false, true]) {
    for (const mutation of ["hook", "source", "child", "control", "output"] as const) {
      if (mutation === "child" && !initialChild) continue
      const expected = makeNative()
      const original = makeNative()
      const sentinel = new RangeError("late native owner hook")
      let expectedReads = 0
      let actualReads = 0
      let expectedThis: unknown
      let actualThis: unknown
      const mutate = (native: MultiSimplifiedPathSolver, side: "expected" | "actual"): void => {
        const observe = (): void => { if (side === "expected") expectedReads++; else actualReads++ }
        if (mutation === "hook") Object.defineProperty(native, "_step", { configurable: true,
          get(): never { observe(); if (side === "expected") expectedThis = this; else actualThis = this; throw sentinel } })
        if (mutation === "source") {
          const routes = native.unsimplifiedHdRoutes
          Object.defineProperty(native, "unsimplifiedHdRoutes", { configurable: true, get(): typeof routes { observe(); return routes } })
        }
        if (mutation === "child") {
          native.activeSubSolver!.MAX_ITERATIONS = 2
          native.activeSubSolver!.solved = true
          native.activeSubSolver!.newRoute = native.activeSubSolver!.inputRoute.route
        }
        if (mutation === "control") native.MAX_ITERATIONS = native.iterations + 3
        if (mutation === "output") native.simplifiedHdRoutes.push(native.unsimplifiedHdRoutes[0]!)
      }
      let eligible = true
      let changed = false
      const executors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
      const coordinator = new ParallelPathLookaheadCoordinator({ original, contextId: 114, workerCount: 4,
        isEligible: (): boolean => eligible,
        run: async (job): Promise<ParallelPathLookaheadResult> => {
          await Promise.resolve()
          const result = executors[job.index % 4]!.execute({ ...structuredClone({ ...job, cancellationBuffer: undefined }), cancellationBuffer: job.cancellationBuffer })
          if (!changed) { changed = true; mutate(original, "actual"); eligible = false }
          return result
        } })
      if (initialChild) { expected.step(); original.step() }
      const escapedExpected = expected.activeSubSolver
      const escapedActual = original.activeSubSolver
      mutate(expected, "expected")
      let expectedError: unknown
      try { expected.solve() } catch (error: unknown) { expectedError = error }
      let actualError: unknown
      try { await coordinator.solve() } catch (error: unknown) { actualError = error }
      expect(coordinator.native).toBe(original)
      expect(state(original)).toEqual(state(expected))
      expect(actualReads).toBe(expectedReads)
      expect(escapedActual?.iterations).toBe(escapedExpected?.iterations)
      expect(escapedActual?.solved).toBe(escapedExpected?.solved)
      expect(coordinator.stats.certifiedRoutes).toBe(0)
      if (mutation === "hook") {
        expect(expectedError).toBe(sentinel)
        expect(actualError).toBe(sentinel)
        expect(expectedThis).toBe(expected)
        expect(actualThis).toBe(original)
      } else if (expected.failed) expect(actualError).toBeInstanceOf(Error)
      else expect(actualError).toBeUndefined()
    }
  }
})
