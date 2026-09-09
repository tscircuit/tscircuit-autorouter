import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9RegionalPhysicalProblem } from "../fixtures/pipeline9RegionalPhysicalClearance"

test("the existing P9 regional construction boundary forwards its prepared physical model", (): void => {
  const problem = createPipeline9RegionalPhysicalProblem()
  const originalNode = structuredClone(problem.node)
  const solver = new Pipeline9HighDensitySolver({
    ...problem.params,
    nodePortPoints: [problem.node],
    fixedHdRoutes: [],
  })
  // Isolate the already existing handoff, without manufacturing a failure,
  // changing its stage policy, or running the later force/repair controller.
  solver.activeNode = problem.node
  solver["startRegionalFallback"]()
  const regional = solver.activeFallbackSolver
  if (!regional) throw new Error("Expected the existing regional constructor")
  expect(regional.params.fixedPadClearance).toBe(
    problem.params.fixedPadClearance,
  )
  const context = regional.highDensitySolver.physicalClearanceContext
  if (!context) throw new Error("Expected the parent's regional physical input")
  expect(context.traceClearanceIndex).toBe(
    problem.params.fixedPadClearance!.traceClearanceIndex,
  )
  expect(context.canonicalNetIdByConnectionName.get("local-target")).toBe(
    problem.canonicalTargetNetId,
  )
  expect(regional.params.nodeWithPortPoints.availableZ).toEqual([0, 1])
  expect(regional.params.nodeWithPortPoints.portPoints).toMatchObject([
    { x: 1, y: -2, z: 0, portPointId: "target-start" },
    { x: 5, y: -2, z: 0, portPointId: "target-end" },
  ])
  expect(regional.params.nodeWithPortPoints.portPointsInPairs).toHaveLength(1)
  expect(problem.node).toEqual(originalNode)
  expect(solver.fixedHdRoutes).toEqual([])
  expect(solver.fixedRouteReplacements.size).toBe(0)
  expect(regional.forceImproveSolver).toBeUndefined()
})
