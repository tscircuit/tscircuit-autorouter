import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import srjJson from "../../fixtures/bug-reports/rf-rc-car-motor-width/rf-rc-car-motor-width.srj.json" with {
  type: "json",
}

function getMinimumWireWidth(
  traces: SimplifiedPcbTrace[],
  connectionName: string,
): number {
  const trace = traces.find((trace) => trace.connection_name === connectionName)!
  return Math.min(
    ...trace.route
      .filter((point) => point.route_type === "wire")
      .map((point) => point.width),
  )
}

test("RF RC car full board reproduces narrowed left-motor routes", async () => {
  const input = structuredClone(srjJson) as SimpleRouteJson
  expect(input.connections).toHaveLength(15)
  expect(input.obstacles).toHaveLength(63)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed, `Pipeline9 failed: ${solver.error}`).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(getMinimumWireWidth(routedTraces, "source_trace_42")).toBeCloseTo(0.15, 6)
  expect(getMinimumWireWidth(routedTraces, "source_trace_43")).toBeCloseTo(0.3, 6)
  expect(getMinimumWireWidth(routedTraces, "source_trace_44")).toBe(1)
  expect(getMinimumWireWidth(routedTraces, "source_trace_45")).toBe(1)

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
