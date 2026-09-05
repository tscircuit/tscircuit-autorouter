import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/pedometer-physical-via-layers.srj.json"

test("pedometer through vias clear traces on every physical layer", () => {
  const srj = input as SimpleRouteJson
  expect(srj.allowBlindAndBuriedVias).toBe(false)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const vias = traces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
  }
  const json = convertToCircuitJson(srj, traces, { originalSrj: srj })
  const { errors } = getDrcErrors(json, { traceClearance: 0.1 })
  const viaTraceErrors = errors.filter(
    (error) =>
      error.type === "pcb_via_trace_clearance_error" ||
      (error.type === "pcb_trace_error" && error.message.includes("pcb_via")),
  )
  expect(viaTraceErrors).toEqual([])
})
