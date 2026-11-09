import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { getMinimumTraceWidthByConnectionName } from "lib/utils/getMinimumTraceWidthByConnectionName"
import { getDeskFidgetMinimumWidthInput } from "../../fixtures/bug-reports/desk-fidget-minimum-width/getDeskFidgetMinimumWidthInput"

test("the complete desk-fidget board routes at its explicit connection minima", async (): Promise<void> => {
  const input = getDeskFidgetMinimumWidthInput("minimum")
  expect(input.connections).toHaveLength(44)
  expect(input.obstacles).toHaveLength(260)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const vssa = input.connections.find(
    (connection) => connection.name === "source_trace_79",
  )!
  expect(vssa.minTraceWidth).toBe(0.15)
  for (const terminal of vssa.pointsToConnect) {
    const terminalWires = traces.flatMap((trace) =>
      trace.route.filter(
        (point) =>
          point.route_type === "wire" &&
          point.layer === terminal.layer &&
          Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6,
      ),
    )
    expect(terminalWires.length).toBeGreaterThan(0)
    expect(
      terminalWires.some(
        (point) =>
          point.route_type === "wire" &&
          point.width >= vssa.minTraceWidth! - 1e-6,
      ),
    ).toBe(true)
  }
  const minima = getMinimumTraceWidthByConnectionName(
    solver.srjWithPointPairs!.connections,
  )
  let constrainedTraceCount = 0
  for (const trace of traces) {
    const minimum = minima.get(trace.connection_name)
    if (minimum === undefined) continue
    constrainedTraceCount++
    for (const point of trace.route) {
      if (point.route_type === "wire") {
        expect(point.width).toBeGreaterThanOrEqual(minimum - 1e-6)
      }
    }
  }
  expect(constrainedTraceCount).toBeGreaterThan(0)
  const result = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
  }
  expect(evaluateRelaxedDrc(result).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(result)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
