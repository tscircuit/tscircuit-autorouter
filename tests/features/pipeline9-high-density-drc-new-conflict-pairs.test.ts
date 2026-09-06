import { expect, test } from "bun:test"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import {
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"

test("Pipeline9 high-density repair does not trade pad errors for a new copper pair", (): void => {
  const padErrors: Pipeline9DrcError[] = [
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_trace_id: "A_0",
      pcb_pad_id: "pad-a",
      actual_clearance: 0.05,
      minimum_clearance: 0.1,
    },
    {
      type: "pcb_pad_trace_clearance_error",
      pcb_trace_id: "A_0",
      pcb_pad_id: "pad-b",
      actual_clearance: 0.05,
      minimum_clearance: 0.1,
    },
  ]
  const newTraceConflict: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "A_0",
    pcb_trace_error_id: "overlap_A_0_B_0",
    actual_clearance: 0.07,
    minimum_clearance: 0.1,
  }
  const viaTraceConflict: Pipeline9DrcError = {
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_trace_ids: ["A_0", "B_0"],
    pcb_via_id: "via_7",
    pcb_via_ids: ["via_7"],
    __via_owner_trace_ids: ["B_0"],
    __trace_segment_owner_trace_id: "A_0",
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }
  const viaPairConflict: Pipeline9DrcError = {
    type: "pcb_via_clearance_error",
    pcb_trace_id: "A_0",
    pcb_trace_ids: ["A_0", "B_0"],
    pcb_via_ids: ["via_7", "via_8"],
    __via_owner_trace_ids: ["A_0", "B_0"],
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }
  const viaPadConflict: Pipeline9DrcError = {
    type: "pcb_pad_pad_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_ids: ["via_7", "pad-a"],
    pcb_via_ids: ["via_7"],
    __via_owner_trace_ids: ["A_0"],
    __pad_ids: ["pad-a"],
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }

  // A lower aggregate error count previously admitted this new trace pair.
  expect(
    isPipeline9DrcCandidateBetter([newTraceConflict], padErrors),
  ).toBeTrue()
  for (const candidate of [
    {
      name: "new trace pair despite removing both pad errors",
      currentErrors: padErrors,
      candidateErrors: [newTraceConflict],
      accepted: false,
    },
    {
      name: "removing one error without creating another pair",
      currentErrors: padErrors,
      candidateErrors: [padErrors[0]!],
      accepted: true,
    },
    {
      name: "improving severity on the existing pairs",
      currentErrors: padErrors,
      candidateErrors: [
        { ...padErrors[0]!, actual_clearance: 0.075 },
        padErrors[1]!,
      ],
      accepted: true,
    },
    {
      name: "a different pad is a new participant",
      currentErrors: padErrors,
      candidateErrors: [{ ...padErrors[0]!, pcb_pad_id: "pad-c" }],
      accepted: false,
    },
    {
      name: "generic pad contact and typed clearance share participants",
      currentErrors: [
        {
          type: "pcb_trace_error",
          pcb_trace_id: "A_0",
          pcb_trace_error_id: "overlap_A_0_pad-a",
          __pad_ids: ["pad-a"],
        },
        padErrors[1]!,
      ],
      candidateErrors: [padErrors[0]!],
      accepted: true,
    },
    {
      name: "via numbering and normalized primary ownership may change",
      currentErrors: [viaTraceConflict],
      candidateErrors: [
        {
          ...viaTraceConflict,
          pcb_trace_id: "B_0",
          pcb_trace_ids: ["B_0", "A_0"],
          pcb_via_id: "via_2",
          pcb_via_ids: ["via_2"],
          actual_clearance: 0.075,
        },
      ],
      accepted: true,
    },
    {
      name: "a via conflict does not authorize a new wire-to-wire conflict",
      currentErrors: [viaTraceConflict],
      candidateErrors: [newTraceConflict],
      accepted: false,
    },
    {
      name: "generic via contact and typed clearance retain copper roles",
      currentErrors: [viaTraceConflict],
      candidateErrors: [
        {
          ...viaTraceConflict,
          type: "pcb_trace_error",
          pcb_trace_error_id: "overlap_A_0_via_2",
          pcb_via_id: "via_2",
          pcb_via_ids: ["via_2"],
          actual_clearance: 0.075,
        },
      ],
      accepted: true,
    },
    {
      name: "reversing the via and wire owners is a different copper pair",
      currentErrors: [viaTraceConflict],
      candidateErrors: [
        {
          ...viaTraceConflict,
          __via_owner_trace_ids: ["A_0"],
          __trace_segment_owner_trace_id: "B_0",
          actual_clearance: 0.075,
        },
      ],
      accepted: false,
    },
    {
      name: "a new via owner is still a new copper pair",
      currentErrors: [viaTraceConflict, ...padErrors],
      candidateErrors: [
        {
          ...viaTraceConflict,
          pcb_trace_ids: ["A_0", "C_0"],
          __via_owner_trace_ids: ["C_0"],
        },
      ],
      accepted: false,
    },
    {
      name: "via-pair numbering does not alter the stable owners",
      currentErrors: [viaPairConflict],
      candidateErrors: [
        {
          ...viaPairConflict,
          pcb_via_ids: ["via_2", "via_3"],
          actual_clearance: 0.075,
        },
      ],
      accepted: true,
    },
    {
      name: "pad-to-via numbering does not alter the stable owner",
      currentErrors: [viaPadConflict],
      candidateErrors: [
        {
          ...viaPadConflict,
          pcb_pad_ids: ["via_2", "pad-a"],
          pcb_via_ids: ["via_2"],
          actual_clearance: 0.075,
        },
      ],
      accepted: true,
    },
    {
      name: "a pad-to-via conflict does not authorize pad-to-wire contact",
      currentErrors: [viaPadConflict, padErrors[1]!],
      candidateErrors: [padErrors[0]!],
      accepted: false,
    },
  ]) {
    expect(
      isPipeline9HighDensityDrcCandidateBetter(
        candidate.candidateErrors,
        candidate.currentErrors,
      ),
      candidate.name,
    ).toBe(candidate.accepted)
  }
})
