import { expect, test } from "bun:test"
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"

test("empty geometric baselines retain every candidate error and its original order", () => {
  const missingConnection = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "missing_connection_route_pcb_port_end",
  }
  const errors = [
    missingConnection,
    {
      type: "pcb_via_clearance_error",
      pcb_error_id: "different_net_vias_close_via_0_via_1",
      pcb_via_ids: ["via_0", "via_1"],
    },
    {
      type: "pcb_trace_error",
      pcb_trace_id: "prepared_trace",
      pcb_trace_error_id: "overlap_prepared_trace_foreign_trace",
    },
  ]
  for (const baselineErrors of [[], [missingConnection]]) {
    const filtered = filterPipeline9DrcErrorsAgainstBaseline({
      errors,
      baselineErrors,
      originalTraceIdByPreparedTraceId: new Map([["prepared_trace", "original_trace"]]),
    })
    expect(filtered).toEqual(errors)
    expect(filtered).not.toBe(errors)
    for (let index = 0; index < errors.length; index++) {
      expect(filtered[index]).toBe(errors[index])
    }
  }
})
