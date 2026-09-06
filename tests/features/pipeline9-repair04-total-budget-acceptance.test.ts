import { expect, test } from "bun:test"
import type { Repair04Solver } from "@tscircuit/repair04"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createTotalBudgetFixture } from "../fixtures/pipeline9-repair04-total-budget-fixture"

test("a total stage budget is not replenished by retained regions and limits the final child's remaining work", (): void => {
  const fixture = createTotalBudgetFixture()
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    enabled: true,
    maxRegions: 10,
    maxInitialCandidateAttempts: 1,
    maxCandidateAttemptsSinceAcceptance: 10,
    maxTotalCandidateAttempts: 6,
    fullEffortReferenceErrorCount: 1,
  })
  const children: Repair04Solver[] = []
  while (!solver.solved && !solver.failed) {
    solver.step()
    const child = (solver as unknown as { localSolver: Repair04Solver | null })
      .localSolver
    if (child && children.at(-1) !== child) children.push(child)
  }
  expect(solver.failed).toBe(false)
  expect(
    children.map(
      (child) => child.getConstructorParams()[0].maxCandidateAttempts,
    ),
  ).toEqual([1, 1])
  expect(solver.stats.candidateAttempts).toBe(2)
  expect(solver.stats.acceptedRegions).toBe(2)
  expect(solver.stats.attemptsSinceAcceptance).toBe(0)
  expect(solver.stats.initialReferenceErrors).toBe(3)
  expect(solver.stats.effectiveMaxTotalCandidateAttempts).toBe(2)
  expect(solver.stats.referenceErrors).toBe(1)
  expect(solver.stats.completionReason).toBe("total-work-budget")
  const output = solver.getOutput()
  expect(
    output.filter(
      (route, index) =>
        JSON.stringify(route) !== JSON.stringify(fixture.hdRoutes[index]),
    ).length,
  ).toBe(2)
  for (const [index, route] of output.entries()) {
    expect(route.route[0]).toEqual(fixture.hdRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(fixture.hdRoutes[index]!.route.at(-1))
    expect(route.vias).toEqual(fixture.hdRoutes[index]!.vias)
  }
})
