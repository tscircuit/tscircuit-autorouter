import { expect, test } from "bun:test"
import { collectNativeEndpointRegionShortlistProof } from "../fixtures/native-endpoint-region/proof"

test("dormant endpoint shortlist preserves native full16 graphs, ordered selections, and observer errors", async () => {
  const proof = await collectNativeEndpointRegionShortlistProof()
  expect(proof.sampleRows).toHaveLength(16)
  expect(proof.sampleRows.every((row: any) => row.admitted && row.graphBuilds === 1 && row.originalTinySearchCalls === 0 && row.candidateTinySearchCalls === 0)).toBe(true)
  expect(proof.randomCases).toBe(20_000)
  expect(proof.ieeeBoundaryCases).toBe(2_640)
  expect(proof.observerCases).toHaveLength(17)
  expect(proof.sourceCopy).toBe(true)
  expect(proof.totals.regionPredicateCalls).toBeLessThan(30_000)
})
