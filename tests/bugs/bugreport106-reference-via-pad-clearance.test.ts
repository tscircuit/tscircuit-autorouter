import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import inputJson from "../../fixtures/bug-reports/bugreport106-pipeline9-qspi-via-pad-overlap/bugreport106-pipeline9-qspi-via-pad-overlap.srj.json"
import observedJson from "../../fixtures/bug-reports/bugreport106-pipeline9-qspi-via-pad-overlap/observed.traces.json"

test("reference DRC detects the reported via-pad overlap with the board rule", (): void => {
  const input = inputJson as SimpleRouteJson
  const result = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces: observedJson as SimplifiedPcbTraces,
    drcOptions: { viaToPadClearance: input.minViaEdgeToPadEdgeClearance },
  })
  const error = result.errorsWithCenters.find(
    (error) => error.type === "pcb_pad_pad_clearance_error" &&
      error.pcb_pad_ids.includes("pcb_smtpad_87"),
  )
  expect(error).toBeDefined()
  expect(error).toMatchObject({ minimum_clearance: 0.25 })
  expect(error!.center).toBeDefined()
  const viaIds = (error as unknown as { pcb_via_ids: string[] }).pcb_via_ids
  expect(viaIds).toHaveLength(1)
  expect(result.circuitJson.some(
    (element) => element.type === "pcb_via" && element.pcb_via_id === viaIds[0],
  )).toBe(true)
})
