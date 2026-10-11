import { expect, test } from "bun:test"
import { ParallelPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import { TinyBitsetSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyBitsetSelectiveReripHyperGraphSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type TinyPipelineHarness = {
  getSolver<T>(name: string): T | undefined
}

test("bitset candidate scoring retains exact SRJ18 selective-rerip pathing", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 16)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    effort: 1, cacheProvider: null,
  })
  pipeline.solveUntilPhase("portPointPathingSolver")
  expect(pipeline.failed).toBe(false)
  const step = pipeline.pipelineDef.find((stage) => stage.solverName === "portPointPathingSolver")
  if (!step) throw new Error("Pipeline9 pathing stage is missing")
  const [params] = step.getConstructorParams(pipeline)
  const sourceParams = params as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  expect(sourceParams.flags.USE_SELECTIVE_RERIP_ROUTING).toBe(true)
  const serial = new TinyHypergraphPortPointPathingSolver(sourceParams)
  const bitset = new ParallelPortPointPathingSolver(sourceParams)
  serial.solve()
  bitset.solve()
  expect(serial.solved).toBe(true)
  expect(bitset.solved).toBe(true)
  expect(bitset.failed).toBe(false)
  expect(bitset.iterations).toBe(serial.iterations)
  expect(bitset.getOutput()).toEqual(serial.getOutput())
  expect(bitset.computeNodePfMap()).toEqual(serial.computeNodePfMap())

  const sourceTinyPipeline = (serial as unknown as { tinyPipelineSolver: TinyPipelineHarness }).tinyPipelineSolver
  const bitsetTinyPipeline = (bitset as unknown as { tinyPipelineSolver: TinyPipelineHarness }).tinyPipelineSolver
  const sourceTiny = sourceTinyPipeline.getSolver<TinyHyperGraphSolver>("solveGraph")!
  const bitsetTiny = bitsetTinyPipeline.getSolver<TinyHyperGraphSolver>("solveGraph")!
  expect(bitsetTiny).toBeInstanceOf(TinyBitsetSelectiveReripHyperGraphSolver)
  expect(bitsetTiny.iterations).toBe(sourceTiny.iterations)
  expect(bitsetTiny.state.regionIntersectionCaches).toEqual(sourceTiny.state.regionIntersectionCaches)
  expect(bitsetTiny.state.portAssignment).toEqual(sourceTiny.state.portAssignment)
  expect(bitsetTiny.stats).toEqual(sourceTiny.stats)
})
