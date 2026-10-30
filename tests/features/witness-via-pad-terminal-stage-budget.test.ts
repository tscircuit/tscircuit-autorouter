import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("the final experiment stage reserves finite steps near the existing parent cap", () => {
  const input = witnessViaPadRepairFixture(1)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input.originalSrj, { cacheProvider: null, experimentWitnessViaPadRepair: true })
  Object.assign(pipeline, { powerTraceExpansionSolver: { solved: true, inputSrj: { fixedTraces: [] }, getOutput: () => input.traces }, srjWithPointPairs: input.pointPairs })
  pipeline.currentPipelineStepIndex = pipeline.pipelineDef.length - 1
  pipeline.iterations = 100
  pipeline.MAX_ITERATIONS = 100
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)
  expect(pipeline.MAX_ITERATIONS).toBe(122)
  expect(pipeline.witnessViaPadRepairSolver?.stats.status).toBe("NO_PROPOSAL")
  expect(pipeline.getOutputSimplifiedPcbTraces()).toEqual(input.traces)
  expect(pipeline.getOutputSimpleRouteJson().traces).toEqual(input.traces)
  const off = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input.originalSrj, { cacheProvider: null })
  expect(Object.hasOwn(off, "witnessViaPadRepairSolver")).toBe(false)
  expect(off.pipelineDef.some((stage) => stage.solverName === "witnessViaPadRepairSolver")).toBe(false)
})
