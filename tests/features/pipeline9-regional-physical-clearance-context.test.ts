import { expect, test } from "bun:test"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { createPipeline9RegionalPhysicalProblem } from "../fixtures/pipeline9RegionalPhysicalClearance"

test("regional HD receives prepared indices and recorded canonical aliases without changing physical inputs", (): void => {
  const problem = createPipeline9RegionalPhysicalProblem()
  const originalNode = structuredClone(problem.node)
  const originalObstacles = structuredClone(problem.obstacles)
  const prepared = problem.params.fixedPadClearance!
  const originalRectangles = structuredClone(prepared.rectangles)
  const solver = new Pipeline9RegionalFallbackSolver(problem.params)
  const hd = solver.highDensitySolver
  const context = hd.physicalClearanceContext
  expect(context).toBeDefined()
  if (!context) throw new Error("Expected regional physical clearance input")
  expect(context.traceClearanceIndex).toBe(prepared.traceClearanceIndex)
  expect(context.viaClearanceIndex).toBe(prepared.viaClearanceIndex)
  expect(context.canonicalNetIdByConnectionName.get("local-target")).toBe(
    problem.canonicalTargetNetId,
  )
  expect(problem.connMap.getNetConnectedToId("local-target")).toBeUndefined()
  expect(context.solveToPhysicalTransform).toEqual({
    center: { x: 3, y: -2 },
    scale: 1,
  })
  expect(context.traceToTraceClearance).toBe(0.1)
  expect(context.viaToTraceClearance).toBe(0.1)
  expect(hd.traceWidth).toBe(0.125)
  expect(hd.viaDiameter).toBe(0.25)
  expect(hd.layerCount).toBe(2)
  expect(hd.obstacleMargin).toBe(0.15)
  expect(hd.unsolvedNodePortPoints).toEqual([originalNode])
  expect(solver.forceImproveSolver).toBeUndefined()
  expect(solver.repairSolver).toBeUndefined()
  expect(problem.node).toEqual(originalNode)
  expect(problem.obstacles).toEqual(originalObstacles)
  expect(prepared.rectangles).toEqual(originalRectangles)
})
