import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimplifiedPcbTrace } from "lib/types"
import { stackSvgsVertically } from "stack-svgs"
import beforeTracesJson from "../../fixtures/bug-reports/desk-fidget-minimum-width/before.traces.json"
import { getDeskFidgetMinimumWidthInput } from "../../fixtures/bug-reports/desk-fidget-minimum-width/getDeskFidgetMinimumWidthInput"

test("the complete desk-fidget board refuses an under-clearance hard-minimum result", async (): Promise<void> => {
  const input = getDeskFidgetMinimumWidthInput("minimum")
  expect(input.connections).toHaveLength(44)
  expect(input.obstacles).toHaveLength(260)
  const nominalInput = getDeskFidgetMinimumWidthInput("nominal")
  const vssa = nominalInput.connections.find(
    (connection) => connection.name === "source_trace_79",
  )!
  const beforeTraces = beforeTracesJson as SimplifiedPcbTrace[]
  expect(beforeTraces).toHaveLength(127)
  // The historical full-board solve emitted 0.10mm at each end of the VSSA
  // connection. Keep the complete native capture rather than inventing copper.
  for (const terminal of vssa.pointsToConnect) {
    expect(
      beforeTraces.some((trace) =>
        trace.route.some(
          (point) =>
            point.route_type === "wire" &&
            point.layer === terminal.layer &&
            Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6 &&
            Math.abs(point.width - 0.1) < 1e-6,
        ),
      ),
    ).toBe(true)
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  // This dense layout exercises detailed routing, rather than just a planning
  // rejection in a fabricated narrow channel. Do not turn it into thin success.
  expect(solver.highDensityRouteSolver!.solved).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.getCurrentPhase()).toBe("traceWidthSolver")
  expect(solver.error).toContain("source_net_0")
  expect(solver.error).toContain("cannot meet minimum trace width 0.15mm")
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )
  const title =
    '<svg width="640" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="12" y="26" font-family="Arial, sans-serif" font-size="12" fill="black">Historical full board: VSSA nominal 0.15 mm; emitted 0.10 mm</text></svg>'
  await expect(
    stackSvgsVertically(
      [
        title,
        getBugReportSnapshotSvg({
          inputSrj: nominalInput,
          srjWithPointPairs: solver.srjWithPointPairs!,
          routedTraces: beforeTraces,
        }),
      ],
      { normalizeSize: false, gap: 0 },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
