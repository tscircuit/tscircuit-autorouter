import { expect, test } from "bun:test"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import { createPipeline9RegionalPhysicalProblem } from "../fixtures/pipeline9RegionalPhysicalClearance"

test("regional physical context composes through existing growth while widths and source layers stay physical", (): void => {
  const problem = createPipeline9RegionalPhysicalProblem()
  const originalNode = structuredClone(problem.node)
  const solver = new Pipeline9RegionalFallbackSolver(problem.params)
  solver.highDensitySolver.step()
  const grow = solver.highDensitySolver.activeSubSolver
  if (!(grow instanceof GrowShrinkHighDensityIntraNodeSolver)) {
    throw new Error("Expected the existing regional grow-shrink solver")
  }
  grow.scaleFactor = 4
  grow.step()
  const portfolio = grow.activeSubSolver ?? grow.winningSolver
  if (!portfolio) throw new Error("Expected the existing regional portfolio")
  const params = portfolio.constructorParams
  const context = params.physicalClearanceContext
  if (!context) throw new Error("Expected scaled regional physical context")
  expect(context.solveToPhysicalTransform).toEqual({
    center: { x: 3, y: -2 },
    scale: 0.25,
  })
  expect(context.traceClearanceIndex).toBe(
    problem.params.fixedPadClearance!.traceClearanceIndex,
  )
  expect(context.canonicalNetIdByConnectionName.get("local-target")).toBe(
    problem.canonicalTargetNetId,
  )
  expect(params.traceWidth).toBe(0.125)
  expect(params.viaDiameter).toBe(0.25)
  expect(params.layerCount).toBe(2)
  expect(params.nodeWithPortPoints.availableZ).toEqual([0])
  expect(params.nodeWithPortPoints.portPoints).toMatchObject([
    { x: -5, y: -2, z: 0, portPointId: "target-start" },
    { x: 11, y: -2, z: 0, portPointId: "target-end" },
  ])
  expect(params.nodeWithPortPoints.portPointsInPairs).toMatchObject([
    [
      { x: -5, y: -2, z: 0, pcb_port_id: "pcb-target-start" },
      { x: 11, y: -2, z: 0, pcb_port_id: "pcb-target-end" },
    ],
  ])
  expect(
    solver.highDensitySolver.physicalClearanceContext?.solveToPhysicalTransform,
  ).toEqual({ center: { x: 3, y: -2 }, scale: 1 })
  expect(problem.node).toEqual(originalNode)
  expect(solver.forceImproveSolver).toBeUndefined()
})
