import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("initial length-matching routing stops before joint DRC without marking the nested pipeline solved", (): void => {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    createPipeline9LengthMatchingPreloadedInput(1),
  )
  pipeline.solveUntilPhase("lengthMatchingPostProcessingSolver")
  const step = pipeline.pipelineDef.find(
    (definition) => definition.solverName === "lengthMatchingPostProcessingSolver",
  )!
  const params = step.getConstructorParams(pipeline)[0] as ConstructorParameters<
    typeof LengthMatchingPostProcessingSolver
  >[0]
  const initialRouting = params.initialRoutingSolver as AutoroutingPipelineSolver9_PreloadedTraceGraph
  const solver = new LengthMatchingPostProcessingSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput().hdRoutes).toHaveLength(2)
  expect(initialRouting.solved).toBe(false)
  expect(initialRouting.failed).toBe(false)
  expect(initialRouting.getCurrentPhase()).toBe("pipeline9JointDrcRepairSolver")
  expect(initialRouting.globalDrcForceImproveSolver?.solved).toBe(true)
  expect(initialRouting.pipeline9JointDrcRepairSolver).toBeUndefined()
  expect(initialRouting.powerTraceExpansionSolver).toBeUndefined()
})
