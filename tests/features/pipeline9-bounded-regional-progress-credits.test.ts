import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createScatteredBoundedRegionalRepairFixture } from "../fixtures/createScatteredBoundedRegionalRepairFixture"

test("accepted whole-board repairs earn work while explicit budgets keep their hard limits", (): void => {
  const adaptiveFixture = createScatteredBoundedRegionalRepairFixture()
  const original = structuredClone(adaptiveFixture.routes)
  const adaptive = new Pipeline9BoundedRegionalRepairSolver({
    ...adaptiveFixture,
    budget: {
      maxRegions: 2,
      maxCandidateAttempts: 2,
      maxPathSearchNodes: 10_000,
      initialMaxRegions: 1,
      initialMaxCandidateAttempts: 1,
      initialMaxPathSearchNodes: 5_000,
      regionsPerAcceptedRepair: 1,
      candidateAttemptsPerAcceptedRepair: 1,
      pathSearchNodesPerAcceptedRepair: 5_000,
    },
  })
  const observedAllowances: number[] = []
  while (!adaptive.solved && !adaptive.failed) {
    adaptive.step()
    observedAllowances.push(adaptive.stats.allowedRegionCount)
  }
  expect(adaptive.failed).toBeFalse()
  const repaired = adaptive.getResult()
  expect(observedAllowances).toContain(1)
  expect(observedAllowances).toContain(2)
  expect(repaired.initialDrcIssueCount).toBe(2)
  expect(repaired.acceptedRegionCount).toBe(2)
  expect(repaired.attemptedRegionCount).toBe(2)
  expect(repaired.candidateAttemptCount).toBe(2)
  expect(repaired.pathSearchNodeCount).toBeGreaterThan(5_000)
  expect(repaired.pathSearchNodeCount).toBeLessThanOrEqual(10_000)
  expect(repaired.publishedDrcIssueCount).toBe(0)
  const validation = adaptiveFixture.drcEvaluator({
    traces: [],
    routes: repaired.routes,
  })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
  expect(adaptiveFixture.routes).toEqual(original)
  for (let index = 0; index < original.length; index++) {
    expect(repaired.routes[index]!.route[0]).toEqual(original[index]!.route[0])
    expect(repaired.routes[index]!.route.at(-1)).toEqual(
      original[index]!.route.at(-1),
    )
    expect(repaired.routes[index]!.traceThickness).toBe(
      original[index]!.traceThickness,
    )
  }

  const fixedFixture = createScatteredBoundedRegionalRepairFixture()
  const fixed = new Pipeline9BoundedRegionalRepairSolver({
    ...fixedFixture,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 1,
      maxPathSearchNodes: 5_000,
    },
  })
  while (!fixed.solved && !fixed.failed) fixed.step()
  expect(fixed.failed).toBeFalse()
  const partial = fixed.getResult()
  expect(partial.acceptedRegionCount).toBe(1)
  expect(partial.attemptedRegionCount).toBe(1)
  expect(partial.candidateAttemptCount).toBe(1)
  expect(partial.pathSearchNodeCount).toBeLessThanOrEqual(5_000)
  expect(fixed.stats.allowedRegionCount).toBe(1)
  expect(fixed.stats.allowedCandidateAttemptCount).toBe(1)
  expect(fixed.stats.allowedPathSearchNodeCount).toBe(5_000)
  expect(partial.publishedDrcIssueCount).toBe(1)
  const partialValidation = fixedFixture.drcEvaluator({
    traces: [],
    routes: partial.routes,
  })
  expect(
    Array.isArray(partialValidation)
      ? partialValidation
      : partialValidation.errors,
  ).toHaveLength(1)
})
