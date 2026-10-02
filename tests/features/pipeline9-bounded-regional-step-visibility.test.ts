import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional repair exposes projection children and advances one child step at a time", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const original = structuredClone(fixture.routes)
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 1,
      maxPathSearchNodes: 5_000,
    },
  })
  expect(() => solver.getResult()).toThrow("before completion")
  solver.step()
  expect(solver.solved).toBeFalse()
  expect(solver.iterations).toBe(1)
  expect(solver.stats.attemptedRegionCount).toBe(0)
  let visibleChildSteps = 0
  let generatorSteps = 0
  const childNames = new Set<string>()
  while (!solver.solved && !solver.failed) {
    const child = solver.activeSubSolver
    const previousChildIterations = child?.iterations
    solver.step()
    if (child) {
      expect(child.iterations).toBe(previousChildIterations! + 1)
      visibleChildSteps++
      childNames.add(child.getSolverName())
    } else {
      generatorSteps++
      if (solver.activeSubSolver) {
        expect(solver.activeSubSolver.iterations).toBe(0)
      }
    }
    if (!solver.solved)
      expect(() => solver.getResult()).toThrow("before completion")
  }
  expect(solver.failed).toBeFalse()
  expect(childNames.has("Pipeline9ClearanceProjectionSolver")).toBeTrue()
  expect(visibleChildSteps).toBeGreaterThan(256)
  expect(generatorSteps).toBeGreaterThan(25)
  expect(solver.progress).toBe(1)
  const result = solver.getResult()
  expect(result.acceptedRegionCount).toBe(1)
  expect(result.publishedDrcIssueCount).toBe(0)
  expect(fixture.routes).toEqual(original)
  const validation = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
})
