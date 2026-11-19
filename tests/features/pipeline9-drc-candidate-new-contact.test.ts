import { expect, test } from "bun:test"
import {
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"

test("pipeline9 DRC candidate with fewer errors is not better when it adds a contact", () => {
  const clearanceError: Pipeline9DrcError = { type: "pcb_trace_error" }
  const contact = (
    firstId: string,
    secondId: string,
  ): Pipeline9DrcError => ({
    type: "pcb_trace_error",
    contact_ids: [firstId, secondId],
  })
  const current = [contact("tA", "pad1"), clearanceError, clearanceError]

  // One error fewer, but tA now also touches pad2.
  expect(
    isPipeline9DrcCandidateBetter([contact("tA", "pad2"), clearanceError], current),
  ).toBe(false)
  // The same contact, named in either order, is not new.
  expect(
    isPipeline9DrcCandidateBetter([contact("pad1", "tA"), clearanceError], current),
  ).toBe(true)
  // Errors without contact_ids are clearance errors and are only counted.
  expect(isPipeline9DrcCandidateBetter([clearanceError], current)).toBe(true)
})
