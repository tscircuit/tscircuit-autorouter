import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 raw routing roomy-preload safety", (): void => {
  const srj = createPipeline9LengthMatchingPreloadedInput(1)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("powerTraceExpansionSolver")
  const before = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getNewTracesBeforePowerExpansion(),
  })
  expect(before.errors).toHaveLength(0)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const after = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(after.errors).toHaveLength(0)
  expect(
    solver
      .getOutputSimpleRouteJson()
      .traces?.find((trace): boolean => trace.pcb_trace_id === "fixed"),
  ).toEqual(srj.traces![0])
  expect(solver._getOutputHdRoutes()).toHaveLength(2)
})
