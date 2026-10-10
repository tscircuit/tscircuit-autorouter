import { expect, test } from "bun:test"
import { hasNoNewOrWorseCopperErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/hasNoNewOrWorseCopperErrors"

test("a lower final copper error count cannot conceal a new trace spacing fault", (): void => {
  const initial = [0, 1, 2].map((index) => ({
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_trace_clearance_error_id: `pad_${index}`,
    minimum_clearance: 0.1,
    actual_clearance: 0.05,
  }))
  const candidate = [
    {
      type: "pcb_trace_error",
      pcb_trace_error_id: "overlap_signal_foreign",
      message: "Trace spacing (gap: 0.094mm)",
    },
  ]
  expect(hasNoNewOrWorseCopperErrors(initial, candidate)).toBeFalse()
})
