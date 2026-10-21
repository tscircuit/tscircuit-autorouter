import { expect, test } from "bun:test"
import { canPublishIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canPublishIndependentClearanceRepairs"
import { canPublishPartialFixedObstacleRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canPublishPartialFixedObstacleRepair"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/srj18-sample16-partial-repair.json"

test("partial repair retains only identified non-worsening via-pad residue", (): void => {
  const viaPad = {
    type: "pcb_pad_pad_clearance_error",
    pcb_trace_id: "signal_0",
    pcb_via_ids: ["via_1"],
    pcb_pad_ids: ["via_1", "pcb_smtpad_62"],
    minimum_clearance: 0.1,
    actual_clearance: 0.05,
  }
  const initialErrors = [
    viaPad,
    {
      type: "pcb_trace_error",
      pcb_trace_id: "other_0",
      pcb_trace_error_id: "overlap_other_0_pcb_smtpad_168",
    },
  ]
  const malformedIdentities = [
    { pcb_trace_id: undefined },
    { pcb_trace_id: 1 },
    { pcb_via_ids: undefined },
    { pcb_via_ids: "via_1" },
    { pcb_via_ids: [] },
    { pcb_via_ids: [1] },
    { pcb_via_ids: ["via_1", "via_2"] },
    { pcb_via_ids: ["unrelated_via"] },
    { pcb_pad_ids: undefined },
    { pcb_pad_ids: "pcb_smtpad_62" },
    { pcb_pad_ids: ["via_1"] },
    { pcb_pad_ids: ["via_1", 1] },
    { pcb_pad_ids: [1, "pcb_smtpad_62"] },
    { pcb_pad_ids: ["via_1", "pcb_smtpad_62", "pcb_smtpad_168"] },
  ]
  const cases: Array<{
    errors: Pipeline9DrcError[]
    initialErrors?: Pipeline9DrcError[]
    allowed: boolean
    regionalAllowed?: boolean
  }> = [
    { errors: [viaPad], allowed: true },
    {
      errors: [{ ...viaPad, actual_clearance: 0.08 }],
      allowed: true,
    },
    {
      errors: [{ ...viaPad, pcb_pad_ids: [...viaPad.pcb_pad_ids].reverse() }],
      allowed: true,
    },
    { errors: initialErrors, allowed: false },
    { errors: [viaPad, viaPad], allowed: false },
    {
      errors: [
        {
          ...viaPad,
          pcb_pad_ids: ["via_2", "pcb_smtpad_62"],
          pcb_via_ids: ["via_2"],
        },
      ],
      allowed: false,
      regionalAllowed: true,
    },
    ...[
      { actual_clearance: 0.04 },
      { actual_clearance: NaN },
      { minimum_clearance: 0.2 },
      { pcb_trace_id: "different_trace" },
      { pcb_pad_ids: ["via_1", "pcb_smtpad_168"] },
      { type: "unknown_error" },
      ...malformedIdentities,
    ].map((change) => ({ errors: [{ ...viaPad, ...change }], allowed: false })),
    ...malformedIdentities.map((change) => ({
      initialErrors: [{ ...viaPad, ...change }, initialErrors[1]!],
      errors: [viaPad],
      allowed: false,
    })),
  ]
  for (const {
    errors,
    initialErrors: before = initialErrors,
    allowed,
    regionalAllowed,
  } of cases) {
    expect(
      canPublishPartialFixedObstacleRepair({
        originalSrj: fixture.srj as SimpleRouteJson,
        initialErrors: before,
        remainingErrors: errors,
      }),
    ).toBe(regionalAllowed ?? allowed)
    expect(canPublishIndependentClearanceRepairs(before, errors)).toBe(
      allowed,
    )
  }
})
