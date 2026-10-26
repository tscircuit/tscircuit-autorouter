import { expect, test } from "bun:test"
import { createRaceHarness, raceNode } from "../fixtures/hdFamilyRace"

test("scale racing leaves cheap preflight failures and simpler or legacy routing modes serial", (): void => {
  const overlap = structuredClone(raceNode)
  for (const point of overlap.portPoints) point.y *= 0.2
  const shared = structuredClone(raceNode)
  for (const point of shared.portPoints) point.rootConnectionName = "shared"
  for (const params of [
    { nodeWithPortPoints: { ...raceNode, availableZ: [0, 1] } },
    { nodeWithPortPoints: overlap },
    { nodeWithPortPoints: shared },
    { fallbackToInvalidGeometryOnFailure: true },
    { rejectOverlappingTerminals: false },
  ]) {
    const { solver, created } = createRaceHarness({
      plans: { 1: { completeAfter: 2, budget: 5 } },
      params,
    })
    solver.step()
    expect(created).toEqual([1])
    expect(solver["scaleSearch"]).toBeUndefined()
    expect(solver.stats.scaleSearchCandidateCount).toBeUndefined()
  }
})
