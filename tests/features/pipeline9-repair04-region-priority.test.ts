import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createTotalBudgetFixture } from "../fixtures/pipeline9-repair04-total-budget-fixture"

test("repair04 prioritizes a dense independent region while keeping the child and total allowances", (): void => {
  const fixture = createTotalBudgetFixture()
  fixture.referenceDrcEvaluator = (): any[] => [
    { type: "pcb_trace_error", message: "isolated", center: { x: 0, y: 0 } },
    { type: "pcb_trace_error", message: "dense first", center: { x: 0, y: 12 } },
    { type: "pcb_trace_error", message: "dense second", center: { x: 1, y: 12 } },
    { type: "pcb_trace_error", message: "dense third", center: { x: 2, y: 12 } },
  ]
  const defaultSolver = new Pipeline9Repair04Solver(fixture) as any
  defaultSolver.step()
  expect(defaultSolver.region.bounds).toEqual({
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  })
  const fullEffortSolver = new Pipeline9Repair04Solver({
    ...fixture,
    maxTotalCandidateAttempts: 7,
    fullEffortReferenceErrorCount: 4,
  }) as any
  fullEffortSolver.step()
  expect(fullEffortSolver.region.bounds).toEqual(defaultSolver.region.bounds)
  expect(fullEffortSolver.effectiveMaxTotalCandidateAttempts).toBe(7)
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    maxCandidatesPerRegion: 40,
    maxInitialCandidateAttempts: 5,
    maxTotalCandidateAttempts: 7,
    fullEffortReferenceErrorCount: 3,
    maxPathSearchNodesPerRegion: 123,
  }) as any
  solver.step()
  expect(solver.region.bounds).toEqual({ minX: -5, maxX: 5, minY: 7, maxY: 17 })
  expect(solver.localSolver.input.maxCandidates).toBe(40)
  expect(solver.localSolver.input.maxCandidateAttempts).toBe(5)
  expect(solver.localSolver.input.maxPathSearchNodes).toBe(123)
  expect(solver.localSolver.input.allowLayerChanges).toBe(false)
  expect(solver.effectiveMaxTotalCandidateAttempts).toBe(5)
  expect(solver.candidateAttempts).toBe(0)
  expect(solver.region.routeMappings.every((mapping: any): boolean => mapping.sourceRouteIndex === 1)).toBe(true)
})
