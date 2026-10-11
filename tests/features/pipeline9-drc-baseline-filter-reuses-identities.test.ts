import { expect, test } from "bun:test"
import { createPipeline9DrcErrorsAgainstBaselineFilter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"

test("Pipeline9 baseline filter keeps candidate aliases separate across evaluations", () => {
  const inheritedTraceError = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "overlap_preloaded_a_preloaded_b",
  }
  const inheritedViaError = {
    type: "pcb_via_clearance_error",
    pcb_trace_ids: ["preloaded_a", "preloaded_b"],
    pcb_center: { x: 2, y: 3 },
    pcb_via_pair_net_relation: "different_net",
  }
  const missingConnectionError = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "missing_connection_preloaded_a_pcb_port_1",
  }
  const filter = createPipeline9DrcErrorsAgainstBaselineFilter([
    inheritedTraceError,
    inheritedViaError,
    missingConnectionError,
  ])
  const candidateErrors = [
    {
      ...inheritedTraceError,
      pcb_trace_error_id: "overlap_section_10_section_1",
    },
    {
      ...inheritedViaError,
      pcb_trace_ids: ["section_1", "section_10", "section_10"],
      pcb_via_ids: ["via_25", "via_26"],
    },
    missingConnectionError,
    { ...inheritedViaError, pcb_center: { x: 2.1, y: 3 } },
    { ...inheritedViaError, pcb_center: undefined },
  ]
  const originalTraceIdByPreparedTraceId = new Map([
    ["section_1", "preloaded_b"],
    ["section_10", "preloaded_a"],
  ])

  expect(filter({ errors: candidateErrors, originalTraceIdByPreparedTraceId }))
    .toEqual(candidateErrors.slice(2))

  originalTraceIdByPreparedTraceId.set("section_10", "new_trace")
  expect(filter({ errors: candidateErrors, originalTraceIdByPreparedTraceId }))
    .toEqual(candidateErrors)

  expect(filter({ errors: candidateErrors })).toEqual(candidateErrors)
  expect(filter({ errors: [inheritedTraceError, inheritedViaError] })).toEqual([])
})
