import { expect, test } from "bun:test";
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filter-pipeline9-drc-errors-against-baseline";

test("Pipeline9 only repairs DRC errors introduced after the prerouted baseline", () => {
  const baselineError = {
    type: "pcb_trace_error",
    pcb_trace_id: "preloaded_a",
    pcb_trace_error_id: "overlap_preloaded_a_preloaded_b",
  };
  const introducedError = {
    type: "pcb_trace_error",
    pcb_trace_id: "new_trace",
    pcb_trace_error_id: "overlap_new_trace_preloaded_a",
  };
  const missingConnectionError = {
    type: "pcb_trace_error",
    pcb_trace_id: "incomplete_trace",
    pcb_trace_error_id: "missing_connection_incomplete_trace_pcb_port_1",
  };

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
      ],
      baselineErrors: [baselineError, missingConnectionError],
      originalTraceIdByPreparedTraceId: new Map([
        ["preloaded_a_preloaded", "preloaded_a"],
      ]),
    }),
  ).toEqual([introducedError, missingConnectionError]);
});
