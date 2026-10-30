import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { witnessViaPadRepairFixture } from "./witnessViaPadRepairFixture"

test("the opt-in certificate retains constructor-time requested declarations", () => {
  const input = witnessViaPadRepairFixture(1)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input.originalSrj, { cacheProvider: null, experimentWitnessViaPadRepair: true })
  input.originalSrj.connections[0]!.name = "caller-mutated-later"
  Object.assign(pipeline, { powerTraceExpansionSolver: { solved: true, inputSrj: { fixedTraces: [] }, getOutput: () => input.traces }, srjWithPointPairs: input.pointPairs })
  pipeline.currentPipelineStepIndex = pipeline.pipelineDef.length - 1
  pipeline.solve()
  expect(pipeline.witnessViaPadRepairSolver?.params.originalSrj).not.toBe(input.originalSrj)
  expect(pipeline.witnessViaPadRepairSolver?.params.originalSrj.connections[0]!.name).toBe("A")
  expect(pipeline.witnessViaPadRepairSolver?.stats.initialCertificateStatus).toBe("PASS")
  expect(pipeline.getOutputSimplifiedPcbTraces()).toEqual(input.traces)
})
