import { expect, test } from "bun:test"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import {
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"

test("Pipeline9 high-density DRC improvement cannot worsen an existing copper pair", (): void => {
  const padA: Pipeline9DrcError = {
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_id: "pad-a",
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }
  const padB: Pipeline9DrcError = {
    ...padA,
    pcb_pad_id: "pad-b",
    actual_clearance: 0.08,
  }
  const viaTrace: Pipeline9DrcError = {
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
  const cases: {
    name: string
    currentErrors: Pipeline9DrcError[]
    candidateErrors: Pipeline9DrcError[]
    accepted: boolean
  }[] = [
    {
      name: "removing one pad error cannot worsen the remaining pad pair",
      currentErrors: [padA, padB],
      candidateErrors: [{ ...padB, actual_clearance: 0.01 }],
      accepted: false,
    },
    {
      name: "a lower total severity cannot compensate for another pair",
      currentErrors: [
        { ...padA, actual_clearance: 0.02 },
        { ...padB, actual_clearance: 0.09 },
      ],
      candidateErrors: [
        { ...padA, actual_clearance: 0.08 },
        { ...padB, actual_clearance: 0.08 },
      ],
      accepted: false,
    },
    {
      name: "one pair cannot gain errors while other pairs disappear",
      currentErrors: [viaTrace, padA, padB],
      candidateErrors: [
        { ...viaTrace, actual_clearance: 0.09 },
        {
          ...viaTrace,
          pcb_via_id: "via_8",
          pcb_via_ids: ["via_8"],
          actual_clearance: 0.09,
        },
      ],
      accepted: false,
    },
    {
      name: "fewer errors on one pair cannot increase its shared severity",
      currentErrors: [
        { ...viaTrace, actual_clearance: 0.08 },
        {
          ...viaTrace,
          pcb_via_id: "via_8",
          pcb_via_ids: ["via_8"],
          actual_clearance: 0.08,
        },
      ],
      candidateErrors: [{ ...viaTrace, actual_clearance: 0.01 }],
      accepted: false,
    },
    {
      name: "removing an error preserves an unchanged remaining pair",
      currentErrors: [padA, padB],
      candidateErrors: [padB],
      accepted: true,
    },
    {
      name: "force severity progress remains valid without a count change",
      currentErrors: [padA, padB],
      candidateErrors: [{ ...padA, actual_clearance: 0.075 }, padB],
      accepted: true,
    },
    {
      name: "same-pair generic contact can improve to typed clearance",
      currentErrors: [
        {
          type: "pcb_trace_error",
          pcb_trace_id: "A_0",
          pcb_trace_error_id: "overlap_A_0_pad-a",
          __pad_ids: ["pad-a"],
        },
      ],
      candidateErrors: [padA],
      accepted: true,
    },
    {
      name: "renumbering a via preserves its stable copper owner roles",
      currentErrors: [viaTrace],
      candidateErrors: [
        {
          ...viaTrace,
          pcb_trace_id: "B_0",
          pcb_trace_ids: ["B_0", "A_0"],
          pcb_via_id: "via_2",
          pcb_via_ids: ["via_2"],
          actual_clearance: 0.075,
        },
      ],
      accepted: true,
    },
  ]
  for (const { name, currentErrors, candidateErrors, accepted } of cases) {
    const originalErrors = structuredClone([currentErrors, candidateErrors])
    // Every case improves the old aggregate objective; only per-pair
    // non-regression distinguishes safe progress from a compensated regression.
    expect(
      isPipeline9DrcCandidateBetter(candidateErrors, currentErrors),
      name,
    ).toBeTrue()
    expect(
      isPipeline9HighDensityDrcCandidateBetter(candidateErrors, currentErrors),
      name,
    ).toBe(accepted)
    expect([currentErrors, candidateErrors], name).toEqual(originalErrors)
  }
})
