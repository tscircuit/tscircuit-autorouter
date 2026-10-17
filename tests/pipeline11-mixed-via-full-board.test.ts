import { expect, test } from "bun:test"
import realBoard from "fixtures/real-boards/rp2040-motor-controller-board.srj.json" with {
  type: "json",
}
import { ApplyTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/ApplyTraceSimplificationSolver"
import { PrepareTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/PrepareTraceSimplificationSolver"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("records mixed vias on a full board", async () => {
  // Start with the repository's complete RP2040 motor-controller board. Only
  // the two via dimensions on this trace differ from the captured board.
  const input = structuredClone(realBoard) as SimpleRouteJson
  const traceId = "source_trace_118_0"
  const trace = input.traces?.find(
    (candidate) => candidate.pcb_trace_id === traceId,
  )
  const vias = trace?.route.filter((point) => point.route_type === "via")
  if (!vias || vias.length !== 2) throw new Error("Expected two internal vias")
  vias[0]!.via_diameter = 0.6
  vias[0]!.via_hole_diameter = 0.3
  vias[1]!.via_diameter = 1.0
  vias[1]!.via_hole_diameter = 0.5

  const prepare = new PrepareTraceSimplificationSolver({
    inputSrj: input,
    options: {},
  })
  prepare.solve()
  const preparedInput = prepare.getOutput()
  const apply = new ApplyTraceSimplificationSolver({
    preparedInput,
    simplifiedHdRoutes: preparedInput.mutableHdRoutes,
  })
  apply.solve()
  const output = apply.getOutput()

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: output,
      routedTraces: output.traces!.map((trace) => ({
        ...trace,
        __replaces_pcb_trace_id: trace.pcb_trace_id,
      })),
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "mixed-via-full-board-before",
  })

  const outputVias = output.traces
    ?.find((candidate) => candidate.pcb_trace_id === traceId)
    ?.route.filter((point) => point.route_type === "via")
  // Characterize the bug: the second via incorrectly inherits the first size.
  expect(
    outputVias?.map((point) => [point.via_diameter, point.via_hole_diameter]),
  ).toEqual([
    [0.6, 0.3],
    [0.6, 0.3],
  ])
})
