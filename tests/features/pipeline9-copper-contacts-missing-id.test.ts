import { expect, test } from "bun:test"
import { getPipeline9DrcErrorCopperPairOrThrow } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"

test("pipeline9 copper pair throws when a contact error does not name two copper objects", () => {
  // Only one side is identified.
  expect(() =>
    getPipeline9DrcErrorCopperPairOrThrow({
      type: "pcb_trace_error",
      pcb_trace_id: "tA",
      pcb_trace_error_id: "trace_error_tA",
    }),
  ).toThrow(
    "Pipeline9 contact error pcb_trace_error must name two copper objects, found 1 (tA)",
  )
  // A via that was never mapped to its trace is not a copper object.
  expect(() =>
    getPipeline9DrcErrorCopperPairOrThrow({
      type: "pcb_via_trace_clearance_error",
      pcb_via_id: "via_0",
      pcb_trace_id: "tA",
    }),
  ).toThrow("found 1 (tA)")
  // Three objects cannot be one contact.
  expect(() =>
    getPipeline9DrcErrorCopperPairOrThrow({
      type: "pcb_trace_error",
      pcb_trace_ids: ["tA", "tB", "tC"],
    }),
  ).toThrow("found 3 (tA, tB, tC)")
  expect(
    getPipeline9DrcErrorCopperPairOrThrow({
      type: "pcb_trace_error",
      pcb_trace_id: "tB",
      pcb_trace_error_id: "overlap_tB_tA",
    }),
  ).toEqual(["tA", "tB"])
})
