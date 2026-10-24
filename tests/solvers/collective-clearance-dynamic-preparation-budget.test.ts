import { expect, test } from "bun:test"
import { CollectiveClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/CollectiveClearanceSolver"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import type { DrcEvaluator } from "high-density-repair03/lib"

test("dynamic native preparation can exceed 100k steps without exhausting either collective or owning wrapper", (): void => {
  let referenceChecks = 0
  const outer = new Pipeline9ClearanceProjectionSolver({
    originalSrj: {
      layerCount: 1, minTraceWidth: 0.1,
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      obstacles: [], connections: [],
    },
    routes: [],
    drcEvaluator: (): ReturnType<DrcEvaluator> => {
      referenceChecks++
      return (referenceChecks === 1 ? [{ type: "pcb_trace_error" }] : []) as unknown as ReturnType<DrcEvaluator>
    },
  })
  outer.step()
  expect(outer.activeSubSolver).toBeInstanceOf(CollectiveClearanceSolver)
  const collective = outer.activeSubSolver as CollectiveClearanceSolver
  const limits = { ...collective.limits }
  const native = collective.preparation as unknown as {
    _step: () => void
    phase: string
    MAX_ITERATIONS: number
    iterations: number
  }
  const originalStep = native._step.bind(native)
  native._step = (): void => {
    if (native.phase === "finalize") {
      originalStep()
      return
    }
    native.MAX_ITERATIONS = 100010
    if (native.iterations === 100005) native.phase = "sweeps"
  }
  let observedDynamicOuterAllowance = false
  while (!outer.solved && !outer.failed) {
    outer.step()
    if (native.iterations === 1) {
      observedDynamicOuterAllowance = outer.MAX_ITERATIONS === collective.MAX_ITERATIONS + 4
    }
  }
  expect(outer.failed).toBe(false)
  expect(collective.failed).toBe(false)
  expect(observedDynamicOuterAllowance).toBe(true)
  expect(native.iterations).toBe(100006)
  expect(collective.iterations).toBeGreaterThan(100000)
  expect(outer.iterations).toBeGreaterThan(100000)
  expect(outer.iterations).toBeLessThanOrEqual(outer.MAX_ITERATIONS)
  expect(collective.limits).toEqual(limits)
  expect(collective.stats.constraintChecks).toBe(0)
  expect(collective.stats.nativeProjectionSweeps).toBe(0)
  expect(outer.getOutput()).toEqual([])
})
