import { expect, test } from "bun:test"
import { hasNoNewOrWorseCopperErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/hasNoNewOrWorseCopperErrors"

test("removing another fault cannot excuse worsening a surviving clearance", (): void => {
  const initial = [0, 1].map((index) => ({
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_trace_clearance_error_id: `pad_${index}`,
    minimum_clearance: 0.1,
    actual_clearance: 0.07,
  }))
  const candidate = [{ ...initial[0]!, actual_clearance: 0.05 }]
  expect(hasNoNewOrWorseCopperErrors(initial, candidate)).toBeFalse()
})
