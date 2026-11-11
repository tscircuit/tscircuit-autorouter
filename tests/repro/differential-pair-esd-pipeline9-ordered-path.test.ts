import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { assertDifferentialPairOutput } from "lib/utils/assertDifferentialPairOutput"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("Pipeline9 matches an ordered J1-ESD-MCU path with an uncounted same-pad tap", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(5)
  for (const connection of srj.connections) {
    const trace = traces.find(
      (trace): boolean => trace.connection_name === connection.name,
    )!
    expect(trace).toBeDefined()
    expect(trace.connectsTo!.toSorted()).toEqual(
      connection.pointsToConnect
        .map((point): string => point.pointId!)
        .toSorted(),
    )
    expect(trace.source_trace_id).toBe(connection.source_trace_id)
  }
  expect(() => assertDifferentialPairOutput(srj, traces)).not.toThrow()
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors,
  ).toEqual([])
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
