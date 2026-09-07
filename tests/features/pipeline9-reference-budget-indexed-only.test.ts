import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("retains indexed-only repair without replenishing work or graduating the initial allowance", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    maxRegions: 10,
    maxInitialCandidateAttempts: 1,
    maxCandidateAttemptsSinceAcceptance: 10,
    maxPathSearchNodesSinceAcceptance: 100000,
    referenceDrcEvaluator: (): ReturnType<typeof fixture.referenceDrcEvaluator> => [
      { type: "remaining_constraint", center: { x: 0, y: 0 } },
    ],
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.acceptedRegions).toBe(1)
  expect(solver.stats.indexedErrors).toBe(0)
  expect(solver.stats.referenceErrors).toBe(1)
  expect(solver.stats.candidateAttempts).toBe(1)
  expect(solver.stats.attemptsSinceAcceptance).toBe(1)
  expect(solver.stats.pathSearchNodes).toBeGreaterThan(0)
  expect(solver.stats.nodesSinceAcceptance).toBe(solver.stats.pathSearchNodes)
  expect(solver.stats.regions).toBe(1)
  expect(solver.stats.completionReason).toBe("unsuccessful-work-budget")
  const routes = solver.getOutput()
  expect(routes).not.toEqual(fixture.hdRoutes)
  for (const [index, route] of routes.entries()) {
    expect(route.route[0]).toEqual(fixture.hdRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(fixture.hdRoutes[index]!.route.at(-1))
    expect(route.vias).toEqual(fixture.hdRoutes[index]!.vias)
  }
})
