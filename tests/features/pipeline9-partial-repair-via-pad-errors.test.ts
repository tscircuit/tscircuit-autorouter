import { expect, test } from "bun:test"
import { canPublishPartialFixedObstacleRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canPublishPartialFixedObstacleRepair"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../fixtures/srj18-sample16-partial-repair.json"

test("guarded partial repairs retain only pre-existing non-worsening via-pad errors", (): void => {
  const viaPadError = {
    type: "pcb_pad_pad_clearance_error",
    pcb_trace_id: "signal_0",
    pcb_via_id: "via_0",
    pcb_pad_ids: ["via_0", "pcb_smtpad_62"],
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }
  const params = {
    originalSrj: fixture.srj as SimpleRouteJson,
    initialErrors: [viaPadError, { type: "pcb_trace_error" }],
  }
  expect(
    canPublishPartialFixedObstacleRepair({
      ...params,
      remainingErrors: [viaPadError],
    }),
  ).toBeTrue()
  for (const error of [
    { ...viaPadError, pcb_pad_ids: ["via_0", "pcb_smtpad_168"] },
    { ...viaPadError, pcb_pad_ids: ["via_0", "unknown_pad"] },
    { ...viaPadError, pcb_trace_id: "new_route" },
    { ...viaPadError, actual_clearance: 0.04 },
    { ...viaPadError, actual_clearance: NaN },
    { ...viaPadError, minimum_clearance: 0.2 },
  ]) {
    expect(
      canPublishPartialFixedObstacleRepair({
        ...params,
        remainingErrors: [error],
      }),
    ).toBeFalse()
  }
  expect(
    canPublishPartialFixedObstacleRepair({
      ...params,
      remainingErrors: [viaPadError, viaPadError],
    }),
  ).toBeFalse()
})
