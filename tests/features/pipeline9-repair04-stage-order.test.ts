import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("Pipeline9 runs bounded repair04 immediately after repair03 and before joint repair", () => {
  const { srj } = createPipeline9Repair04Fixture()
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  const stageNames = pipeline.pipelineDef.map((step) => step.solverName)
  const repair04Index = stageNames.indexOf("repair04Solver")
  expect(repair04Index).toBeGreaterThan(0)
  expect(stageNames.slice(repair04Index - 1, repair04Index + 2)).toEqual([
    "globalDrcForceImproveSolver",
    "repair04Solver",
    "pipeline9JointDrcRepairSolver",
  ])
  expect(pipeline.pipelineDef[repair04Index]!.solverClass).toBe(
    Pipeline9Repair04Solver,
  )
})
