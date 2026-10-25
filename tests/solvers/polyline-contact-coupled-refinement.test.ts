import { expect, test } from "bun:test"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("coupled refinement separates complete finite-width segments without moving terminals", (): void => {
  const { solver, candidate } = createPolylineContactFixture()
  const terminals = candidate.polyLines.map((line) => [{ ...line.start }, { ...line.end }])
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.stats.contactQpRowUpdates).toBeGreaterThan(0)
  expect(solver.stats.contactAcceptedSteps).toBeGreaterThan(0)
  expect(solver.stats.contactValidatedSolutions).toBe(1)
  expect(candidate.polyLines[0]!.mPoints[0]!.y).toBeLessThan(-0.02)
  expect(candidate.polyLines[1]!.mPoints[0]!.y).toBeGreaterThan(0.02)
  expect(solver.computeMinGapBtwPolyLines(candidate.polyLines).every((gap): boolean => gap >= 0.1)).toBe(true)
  expect(candidate.polyLines.map((line) => [line.start, line.end])).toEqual(terminals)
  expect(solver.solvedRoutes).toHaveLength(2)
})
