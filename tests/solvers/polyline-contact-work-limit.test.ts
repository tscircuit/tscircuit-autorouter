import { expect, test } from "bun:test"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("local contact work exhaustion remains an explicit unknown with unchanged coordinates", (): void => {
  const { solver, candidate } = createPolylineContactFixture(1)
  const original = structuredClone(candidate.polyLines)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("unknown: bounded model work exhausted")
  expect(Number(solver.stats.contactWorkUnits ?? 0)).toBeLessThanOrEqual(1)
  expect(candidate.polyLines).toEqual(original)
  expect(solver.solvedRoutes).toHaveLength(0)
})
