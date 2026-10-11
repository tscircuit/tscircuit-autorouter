import { expect, test } from "bun:test"
import { ParallelPortPointPathingSolver, type Pipeline9PathingStrategy } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import { TinyBitsetSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyBitsetSelectiveReripHyperGraphSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type TinyPipelineHarness = {
  getSolver<T>(name: string): T | undefined
}

test("all pathing strategies retain exact SRJ18 selective-rerip paths and counters", async (): Promise<void> => {
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
  const variants = (["indexed", "adaptive-bitset", "cached-cost"] as const).map((strategy: Pipeline9PathingStrategy) =>
    ({ strategy, solver: new ParallelPortPointPathingSolver(sourceParams, { strategy }) }))
  serial.solve()
  expect(serial.solved).toBe(true)
  const sourceTinyPipeline = (serial as unknown as { tinyPipelineSolver: TinyPipelineHarness }).tinyPipelineSolver
  const sourceTiny = sourceTinyPipeline.getSolver<TinyHyperGraphSolver>("solveGraph")!
  for (const { strategy, solver } of variants) {
    const tinyPipeline = (solver as unknown as { tinyPipelineSolver: TinyPipelineHarness }).tinyPipelineSolver
    while (!tinyPipeline.getSolver<TinyHyperGraphSolver>("solveGraph")) solver.step()
    const tiny = tinyPipeline.getSolver<TinyHyperGraphSolver>("solveGraph")!
    if (tiny instanceof TinyBitsetSelectiveReripHyperGraphSolver) tiny.bitsetCostCache.collectDiagnostics = true
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.iterations).toBe(serial.iterations)
    expect(solver.getOutput()).toEqual(serial.getOutput())
    expect(solver.computeNodePfMap()).toEqual(serial.computeNodePfMap())
    expect(tiny.iterations).toBe(sourceTiny.iterations)
    expect(tiny.state.regionIntersectionCaches).toEqual(sourceTiny.state.regionIntersectionCaches)
    expect(tiny.state.portAssignment).toEqual(sourceTiny.state.portAssignment)
    expect(tiny.stats).toEqual(sourceTiny.stats)
    expect(tiny.stats.partialRipCount).toBeGreaterThan(0)
    if (strategy === "cached-cost") {
      if (!(tiny instanceof TinyBitsetSelectiveReripHyperGraphSolver)) throw new Error("Cached strategy selected the wrong solver")
      expect(tiny.bitsetCostCache.diagnostics.hits).toBeGreaterThan(0)
      expect(tiny.bitsetCostCache.diagnostics.misses).toBeGreaterThan(0)
    }
  }
})
