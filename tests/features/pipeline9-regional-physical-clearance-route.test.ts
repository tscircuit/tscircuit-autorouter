import { expect, test } from "bun:test"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { createPipeline9RegionalPhysicalProblem } from "../fixtures/pipeline9RegionalPhysicalClearance"

test("regional HD completes a real planar detour around a foreign pad before inner force starts", (): void => {
  const problem = createPipeline9RegionalPhysicalProblem()
  const originalNode = structuredClone(problem.node)
  const originalObstacles = structuredClone(problem.obstacles)
  const solver = new Pipeline9RegionalFallbackSolver(problem.params)
  const index = problem.params.fixedPadClearance!.traceClearanceIndex
  expect(
    index.isSegmentClear({
      start: problem.pair[0],
      end: problem.pair[1],
      canonicalNetId: problem.canonicalTargetNetId,
      copperDiameter: problem.params.traceWidth,
    }),
  ).toBe(false)
  // Run only the existing public inner HD solver, stopping before the regional
  // controller can construct force/repair. This is not a final-board claim.
  solver.highDensitySolver.solve()
  expect(solver.highDensitySolver.solved).toBe(true)
  expect(solver.highDensitySolver.failed).toBe(false)
  expect(solver.highDensitySolver.routes).toHaveLength(1)
  const route = solver.highDensitySolver.routes[0]!
  expect(route.connectionName).toBe("local-target")
  expect(route.traceThickness).toBe(0.125)
  expect(route.viaDiameter).toBe(0.25)
  expect(route.vias).toEqual([])
  expect(route.route.length).toBeGreaterThan(2)
  expect(route.route[0]).toMatchObject({ x: 1, y: -2, z: 0 })
  expect(route.route.at(-1)).toMatchObject({ x: 5, y: -2, z: 0 })
  for (let pointIndex = 0; pointIndex < route.route.length; pointIndex++) {
    const point = route.route[pointIndex]!
    expect(point.z).toBe(0)
    expect(
      index.isPointClear({
        point,
        canonicalNetId: problem.canonicalTargetNetId,
        copperDiameter: route.traceThickness,
      }),
    ).toBe(true)
    if (pointIndex === 0) continue
    expect(
      index.isSegmentClear({
        start: route.route[pointIndex - 1]!,
        end: point,
        canonicalNetId: problem.canonicalTargetNetId,
        copperDiameter: route.traceThickness,
      }),
    ).toBe(true)
  }
  expect(problem.node).toEqual(originalNode)
  expect(problem.obstacles).toEqual(originalObstacles)
  expect(solver.forceImproveSolver).toBeUndefined()
  expect(solver.repairSolver).toBeUndefined()
})
