import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/muse-eink-via-copper-clearance/muse-eink-via-copper-clearance.srj.json" with {
  type: "json",
}
import capturedOutput from "../../fixtures/bug-reports/muse-eink-via-copper-clearance/muse-eink-via-copper-clearance.original-output.json" with {
  type: "json",
}
import { getMuseViaClearanceSnapshot } from "../fixtures/get-muse-via-clearance-snapshot"

// Frozen unmodified output from published 0.0.953, cache disabled, effort 1.
// Use today's checker and the same board rules for both comparison snapshots.
test("original Muse output visibly reproduces the copper clearance error", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces: structuredClone(capturedOutput) as SimplifiedPcbTrace[],
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  }
  const drc = evaluateRelaxedDrc(snapshotInput)
  expect(drc.errors).toHaveLength(1)
  expect(drc.errors[0]!.type).toBe("pcb_via_clearance_error")
  const snapshot = getMuseViaClearanceSnapshot(snapshotInput)
  expect(snapshot.copperGap).toBeCloseTo(0.13541082528299198, 12)
  await expect(snapshot.svg).toMatchSvgSnapshot(import.meta.path)
})
