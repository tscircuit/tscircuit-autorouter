import { expect, test } from "bun:test"
import {
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"

test("pipeline9 DRC candidate that adds a contact is not better when new contacts are rejected", () => {
  const clearanceError: Pipeline9DrcError = { type: "pcb_trace_error" }
  const traceAOnPad1: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "tA",
    pcb_smtpad_id: "pad1",
    actual_clearance: -0.02,
  }
  const traceAOnTraceB: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "tA",
    pcb_trace_ids: ["tA", "tB"],
    actual_clearance: -0.02,
  }
  // tB touching tA's via shorts the same two traces as tA touching tB.
  const traceBOnViaOfTraceA: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "tB",
    pcb_via_id: "via_3",
    pcb_trace_ids: ["tB", "tA"],
    actual_clearance: -0.01,
  }
  const traceAOnPad2: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "tA",
    pcb_smtpad_id: "pad2",
    actual_clearance: -0.02,
  }
  // The same objects 0.05mm apart: a clearance error, not a contact.
  const traceANearPad2: Pipeline9DrcError = {
    ...traceAOnPad2,
    actual_clearance: 0.05,
  }
  const current = [traceAOnPad1, traceAOnTraceB, clearanceError, clearanceError]
  // Each candidate has fewer errors than the current routes.
  const newContact = [traceAOnPad1, traceAOnTraceB, traceAOnPad2]
  const sameContacts = [traceAOnPad1, traceBOnViaOfTraceA, clearanceError]
  const clearanceErrorsOnly = [clearanceError, traceANearPad2]

  const rejectNewContacts = { rejectNewContacts: true }

  expect(
    isPipeline9DrcCandidateBetter(newContact, current, rejectNewContacts),
  ).toBe(false)
  // Without the option, a new contact is counted like any other error.
  expect(isPipeline9DrcCandidateBetter(newContact, current)).toBe(true)
  expect(
    isPipeline9DrcCandidateBetter(sameContacts, current, rejectNewContacts),
  ).toBe(true)
  // Clearance errors, near-misses included, are only counted.
  expect(
    isPipeline9DrcCandidateBetter(
      clearanceErrorsOnly,
      current,
      rejectNewContacts,
    ),
  ).toBe(true)
})
