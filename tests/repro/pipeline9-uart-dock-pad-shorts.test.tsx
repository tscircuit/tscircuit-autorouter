import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import inputJson from "../../fixtures/bug-reports/uart-dock-pad-shorts/uart-dock-pad-shorts.srj.json"

// Captured from UART Dock, reduced from 44 to 22 nets. Native pad positions,
// clearances and outline are retained: smaller captures routed without the short.
test("captures UART Dock CH342F pad shorts after Pipeline 9 completes", async (): Promise<void> => {
  const input = structuredClone(inputJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { errors } = evaluateRelaxedDrc(snapshotInput)
  // U_BRIDGE: the CTS1 trace contacts the separate RTS1 pad (pins 10 and 11).
  expect(
    errors.some(
      (error) =>
        error.type === "pcb_trace_error" &&
        error.pcb_trace_error_id === "overlap_source_net_21_0_pcb_smtpad_54",
    ),
  ).toBe(true)
  await expect(
    getBugReportSnapshotSvg(snapshotInput, { showErrorLocations: true }),
  ).toMatchSvgSnapshot(import.meta.path)
})
