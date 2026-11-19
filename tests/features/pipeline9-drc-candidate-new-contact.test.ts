import { expect, test } from "bun:test"
import {
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"

test("pipeline9 DRC candidate that adds a contact is not better when new contacts are rejected", () => {
  const clearanceError: Pipeline9DrcError = { type: "pcb_trace_error" }
  const traceOnPad1: Pipeline9DrcError = {
    type: "pcb_trace_error",
    contact_ids: ["tA", "pad1"],
  }
  const pad1UnderTrace: Pipeline9DrcError = {
    type: "pcb_trace_error",
    contact_ids: ["pad1", "tA"],
  }
  const traceOnPad2: Pipeline9DrcError = {
    type: "pcb_trace_error",
    contact_ids: ["tA", "pad2"],
  }
  const current = [traceOnPad1, clearanceError, clearanceError]
  // Each candidate has one error fewer than the current routes.
  const newContact = [traceOnPad2, clearanceError]
  const reorderedContact = [pad1UnderTrace, clearanceError]
  const clearanceErrorsOnly = [clearanceError]

  const rejectNewContacts = { rejectNewContacts: true }

  expect(
    isPipeline9DrcCandidateBetter(newContact, current, rejectNewContacts),
  ).toBe(false)
  // Without the option, a new contact is counted like any other error.
  expect(isPipeline9DrcCandidateBetter(newContact, current)).toBe(true)
  expect(
    isPipeline9DrcCandidateBetter(reorderedContact, current, rejectNewContacts),
  ).toBe(true)
  // Errors without contact_ids are clearance errors and are only counted.
  expect(
    isPipeline9DrcCandidateBetter(
      clearanceErrorsOnly,
      current,
      rejectNewContacts,
    ),
  ).toBe(true)
})
