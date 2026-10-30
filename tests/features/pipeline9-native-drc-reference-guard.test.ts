import { expect, test } from "bun:test"
import { validateNativeDrcCandidate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/validateNativeDrcCandidate"

test("a native false clean result returns the independent reference errors", (): void => {
  let calls = 0
  const reference = { errors: [{ type: "pcb_trace_error" }], errorsWithCenters: [{ type: "pcb_trace_error", center: { x: 1, y: 2 } }] }
  const guarded = validateNativeDrcCandidate(
    { errors: [], errorsWithCenters: [] },
    () => { calls++; return reference },
  )
  expect(calls).toBe(1)
  expect(guarded).toEqual(reference)
})
