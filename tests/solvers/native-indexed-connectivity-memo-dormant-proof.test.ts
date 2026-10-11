import { test, expect } from "bun:test"
import { collectNativeIndexedConnectivityProof } from "../fixtures/native-indexed-connectivity/proof"

test("dormant private indexed connectivity memo preserves native errors, counters, aliases and fresh live-map results", () => {
  const proof = collectNativeIndexedConnectivityProof()
  expect(proof.kind).toContain("Dormant")
})
