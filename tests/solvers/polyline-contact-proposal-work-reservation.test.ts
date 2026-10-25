import { expect, test } from "bun:test"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("a checked QP proposal cannot mutate geometry when merit work cannot be prepaid", (): void => {
  let exhaustedProposals = 0
  for (const cap of [2000, 4000, 8000, 16000, 32000, 48000]) {
    const { solver, candidate } = createPolylineContactFixture(cap)
    while (!solver.solved && !solver.failed) {
      const before = structuredClone(candidate.polyLines)
      const proposals = Number(solver.stats.contactWorkCappedProposals ?? 0)
      solver.step()
      if (solver.failed && Number(solver.stats.contactWorkCappedProposals ?? 0) > proposals) {
        exhaustedProposals++
        expect(candidate.polyLines).toEqual(before)
        expect(solver.error).toContain("bounded model work exhausted")
        expect(solver.solvedRoutes).toHaveLength(0)
      }
    }
    expect(Number(solver.stats.contactWorkUnits ?? 0)).toBeLessThanOrEqual(cap)
  }
  expect(exhaustedProposals).toBeGreaterThan(0)
})
