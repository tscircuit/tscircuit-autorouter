import { expect, test } from "bun:test"
import {
  isPipeline9DrcCandidateBetter,
  isPipeline9DrcCandidateNoWorse,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"

test("Pipeline9 repair candidates cannot trade DRCs for new illegal copper contacts", () => {
  const currentErrors = [
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_pad_trace_clearance_error_id: "clearance_a",
      message: "trace and pad are too close (gap: 0.05mm)",
      actual_clearance: 0.05,
    },
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_pad_trace_clearance_error_id: "clearance_b",
      message: "trace and pad are too close (gap: 0.06mm)",
      actual_clearance: 0.06,
    },
  ]
  const fewerErrorsWithNewContact = [
    {
      type: "pcb_trace_error",
      pcb_trace_error_id: "overlap_trace_a_pcb_plated_hole_a",
      message:
        'PCB trace "trace_a" overlaps with pcb_plated_hole "hole_a" (accidental contact)',
      actual_clearance: -0.05,
    },
  ]
  const existingIllegalContacts = [
    {
      type: "pcb_trace_error",
      pcb_trace_error_id: "overlap_trace_b_pcb_via_a",
      message: 'PCB trace "trace_b" overlaps with pcb_via "via_a"',
    },
    {
      type: "pcb_trace_error",
      pcb_trace_error_id: "overlap_trace_c_pcb_trace_d",
      message: 'PCB trace "trace_c" overlaps with pcb_trace "trace_d"',
    },
  ]
  const fewerButNewIllegalContacts = [
    {
      type: "pcb_trace_error",
      pcb_trace_error_id: "overlap_trace_e_pcb_via_b",
      message: 'PCB trace "trace_e" overlaps with pcb_via "via_b"',
    },
  ]

  expect(
    isPipeline9DrcCandidateBetter(fewerErrorsWithNewContact, currentErrors),
  ).toBeFalse()
  expect(
    isPipeline9DrcCandidateBetter(
      [
        {
          type: "pcb_pad_trace_clearance_error",
          pcb_pad_trace_clearance_error_id: "clearance_c",
          message: "trace and pad are too close (gap: 0.04mm)",
          actual_clearance: 0.04,
        },
      ],
      currentErrors,
    ),
  ).toBeTrue()
  expect(
    isPipeline9DrcCandidateNoWorse(currentErrors, currentErrors),
  ).toBeTrue()
  expect(
    isPipeline9DrcCandidateNoWorse(fewerErrorsWithNewContact, currentErrors),
  ).toBeFalse()
  expect(
    isPipeline9DrcCandidateBetter(
      fewerButNewIllegalContacts,
      existingIllegalContacts,
    ),
  ).toBeFalse()
  expect(
    isPipeline9DrcCandidateNoWorse(
      fewerButNewIllegalContacts,
      existingIllegalContacts,
    ),
  ).toBeFalse()
})
