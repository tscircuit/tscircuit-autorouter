import { expect, test } from "bun:test"
import { shouldUseSparseCandidateStorage } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("TinyHypergraph candidate storage stays dense below the hop budget", () => {
  expect(shouldUseSparseCandidateStorage(2000, 2000)).toBe(false)
  expect(shouldUseSparseCandidateStorage(2001, 2000)).toBe(true)
})
