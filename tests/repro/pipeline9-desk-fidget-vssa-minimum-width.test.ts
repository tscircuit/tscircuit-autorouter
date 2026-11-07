import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { stackSvgsVertically } from "stack-svgs"
import { getDeskFidgetVssaMinimumWidthInput } from "../../fixtures/bug-reports/desk-fidget-minimum-width/getDeskFidgetMinimumWidthInput"

test("the real desk-fidget VSSA phase routes 0.15mm copper with all board obstacles retained", async (): Promise<void> => {
  const input = getDeskFidgetVssaMinimumWidthInput()
  expect(input.layerCount).toBe(2)
  expect(input.obstacles).toHaveLength(261)
  expect(input.traces).toHaveLength(3)
  expect(input.connections).toHaveLength(1)
  const connection = input.connections[0]!
  expect(connection.name).toBe("source_trace_79")
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  const wires = traces[0]!.route.filter((point) => point.route_type === "wire")
  expect(wires.length).toBeGreaterThan(0)
  expect(wires.every((point) => point.width >= 0.15 - 1e-6)).toBe(true)
  for (const terminal of connection.pointsToConnect) {
    expect(
      wires.some(
        (point) =>
          point.layer === terminal.layer &&
          Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6,
      ),
    ).toBe(true)
  }
  expect(solver.getOutputSimpleRouteJson().traces!.slice(0, 3)).toEqual(
    input.traces!,
  )
  const result = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
  }
  expect(evaluateRelaxedDrc(result).errors).toEqual([])
  const title =
    '<svg width="640" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="12" y="26" font-family="Arial, sans-serif" font-size="12" fill="black">Scoped VSSA phase: hard minimum 0.15 mm; emitted 0.15 mm</text></svg>'
  await expect(
    stackSvgsVertically([title, getBugReportSnapshotSvg(result)], {
      normalizeSize: false,
      gap: 0,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
