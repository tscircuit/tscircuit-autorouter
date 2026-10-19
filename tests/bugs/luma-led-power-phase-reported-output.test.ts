import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/luma-led-power-phase/luma-led-power-phase.srj.json" with { type: "json" }
import capturedOutput from "../../fixtures/bug-reports/luma-led-power-phase/luma-led-power-phase.reported-output.json" with { type: "json" }

test("captured Luma output preserves the reported pad and via violations", (): void => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const after = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces: structuredClone(capturedOutput) as SimplifiedPcbTrace[],
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  expect(after.errors).toHaveLength(3)
  expect(
    after.errors.every((error) => error.type === "pcb_pad_trace_clearance_error"),
  ).toBe(true)
  expect(checkViasInPads(after.circuitJson)).toHaveLength(3)
})
