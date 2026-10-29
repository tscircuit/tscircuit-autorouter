import { expect, test } from "bun:test"
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"

test("Pipeline9 only repairs DRC errors introduced after the prerouted baseline", () => {
  const baselineError = {
    type: "pcb_trace_error",
    pcb_trace_id: "preloaded_a",
    pcb_trace_error_id: "overlap_preloaded_a_preloaded_b",
  }
  const introducedError = {
    type: "pcb_trace_error",
    pcb_trace_id: "new_trace",
    pcb_trace_error_id: "overlap_new_trace_preloaded_a",
  }
  const missingConnectionError = {
    type: "pcb_trace_error",
    pcb_trace_id: "incomplete_trace",
    pcb_trace_error_id: "missing_connection_incomplete_trace_pcb_port_1",
  }
  const inheritedViaClearanceError = {
    type: "pcb_via_clearance_error",
    pcb_error_id: "different_net_vias_close_via_0_via_1",
    pcb_via_ids: ["via_0", "via_1"],
    pcb_trace_ids: ["preloaded_a", "preloaded_b"],
    pcb_via_pair_net_relation: "different_net",
    pcb_center: { x: 2, y: 3 },
  }
  const reorderedInheritedViaClearanceError = {
    ...inheritedViaClearanceError,
    pcb_error_id: "different_net_vias_close_via_1_via_0",
    pcb_via_ids: ["via_1", "via_0"],
    pcb_trace_ids: ["preloaded_b", "preloaded_a_preloaded"],
    pcb_center: undefined,
    center: { x: 2, y: 3 },
  }
  const differentOwnerViaClearanceError = {
    ...inheritedViaClearanceError,
    pcb_trace_ids: ["new_trace", "preloaded_b"],
  }
  const movedViaClearanceError = {
    ...inheritedViaClearanceError,
    pcb_center: { x: 2.1, y: 3 },
  }

  expect(
    filterPipeline9DrcErrorsAgainstBaseline({
      errors: [
        {
          ...baselineError,
          pcb_trace_id: "preloaded_a_preloaded",
          pcb_trace_error_id: "overlap_preloaded_a_preloaded_preloaded_b",
        },
        introducedError,
        missingConnectionError,
        reorderedInheritedViaClearanceError,
        differentOwnerViaClearanceError,
        movedViaClearanceError,
      ],
      baselineErrors: [
        baselineError,
        missingConnectionError,
        inheritedViaClearanceError,
      ],
      originalTraceIdByPreparedTraceId: new Map([
        ["preloaded_a_preloaded", "preloaded_a"],
      ]),
    }),
  ).toEqual([
    introducedError,
    missingConnectionError,
    differentOwnerViaClearanceError,
    movedViaClearanceError,
  ])
})
