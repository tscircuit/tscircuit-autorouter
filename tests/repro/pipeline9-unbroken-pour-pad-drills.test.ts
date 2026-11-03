import { beforeAll, expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "./assets/core-unbroken-inner-pours.json"

// Captured from core's example39-unbroken-copper-pour-escape-vias circuit.
const inputSrj: SimpleRouteJson = structuredClone(input)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj)

beforeAll(async (): Promise<void> => {
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  // Snapshot failures must not be swallowed by test.failing.
  await expect(
    getBugReportSnapshotSvg({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      // Escape endpoints terminate in pours, which continuity does not model.
      drcOptions: { includeTraceContinuity: false },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})

test.failing("copper pours do not force extra escape vias", (): void => {
  const traces = solver.getOutputSimplifiedPcbTraces()
  const vias = traces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )
  expect(traces).toHaveLength(13)
  expect(vias).toHaveLength(7)
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
  })
  expect(evaluate(traces, { includeTraceContinuity: false }).errors).toEqual([])
})
