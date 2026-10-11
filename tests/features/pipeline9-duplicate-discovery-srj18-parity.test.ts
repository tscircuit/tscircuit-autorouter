import { expect, test } from "bun:test"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/DuplicateCongestedPortSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { ParallelDuplicateCongestedPortSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelDuplicateCongestedPortSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

class NativeDiscoveryPathing extends TinyHypergraphPortPointPathingSolver {
  declare discovery: DuplicateCongestedPortSolver
  protected override createDuplicateCongestedPortSolver(
    graph: ConstructorParameters<typeof DuplicateCongestedPortSolver>[0],
    options: ConstructorParameters<typeof DuplicateCongestedPortSolver>[1],
  ): DuplicateCongestedPortSolver {
    this.discovery = super.createDuplicateCongestedPortSolver(graph, options)
    return this.discovery
  }
}

class IndexedDiscoveryPathing extends TinyHypergraphPortPointPathingSolver {
  declare discovery: ParallelDuplicateCongestedPortSolver
  protected override createDuplicateCongestedPortSolver(
    graph: ConstructorParameters<typeof DuplicateCongestedPortSolver>[0],
    options: ConstructorParameters<typeof DuplicateCongestedPortSolver>[1],
  ): ParallelDuplicateCongestedPortSolver {
    this.discovery = new ParallelDuplicateCongestedPortSolver(graph, options)
    this.discovery.collectCostIndexDiagnostics = true
    return this.discovery
  }
}

test("indexed duplicate discovery preserves complete SRJ18 001/006/016 graphs, paths, PF and budgets", async (): Promise<void> => {
  const workCounts: Array<Record<string, unknown>> = []
  for (const sample of [1, 6, 16]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample, 1)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, { effort: 1, cacheProvider: null })
    pipeline.solveUntilPhase("portPointPathingSolver")
    expect(pipeline.failed).toBe(false)
    const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "portPointPathingSolver")
    if (!stage) throw new Error("Duplicate discovery parity fixture is missing pathing")
    const [params] = stage.getConstructorParams(pipeline)
    const input = params as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
    const native = new NativeDiscoveryPathing(structuredClone(input))
    const indexed = new IndexedDiscoveryPathing(structuredClone(input))
    expect(indexed.discovery.solved).toBe(true)
    expect(indexed.discovery.failed).toBe(false)
    expect(indexed.discovery.report).toEqual(native.discovery.report)
    expect(indexed.discovery.getOutput()).toEqual(native.discovery.getOutput())
    expect(indexed.discovery.options).toEqual(native.discovery.options)
    native.solve(); indexed.solve()
    expect(native.solved).toBe(true)
    expect(indexed.solved).toBe(true)
    expect(indexed.failed).toBe(false)
    expect(indexed.getOutput()).toEqual(native.getOutput())
    expect(indexed.computeNodePfMap()).toEqual(native.computeNodePfMap())
    expect(indexed.iterations).toBe(native.iterations)
    expect(indexed.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
    expect(indexed.stats.candidatePortfolioSelectedCandidate).toBe(native.stats.candidatePortfolioSelectedCandidate)
    expect(indexed.stats.candidatePortfolioPrimarySummary).toEqual(native.stats.candidatePortfolioPrimarySummary)
    const nativeMetrics = native.getSolveGraphBenchmarkMetrics()
    const indexedMetrics = indexed.getSolveGraphBenchmarkMetrics()
    if (!nativeMetrics || !indexedMetrics) throw new Error("Solved pathing fixture has no search diagnostics")
    const { timeMs: _nativeTime, ...nativeCounters } = nativeMetrics
    const { timeMs: _indexedTime, ...indexedCounters } = indexedMetrics
    expect(indexedCounters).toEqual(nativeCounters)
    expect(indexed.discovery.costIndexDiagnostics.hits).toBeGreaterThan(0)
    workCounts.push({ sample, independentRoutes: indexed.discovery.routeDiagnostics.length,
      independentIterations: indexed.discovery.stats.independentRouteIterations,
      maximumIterationsPerRoute: indexed.discovery.routeDiagnostics[0]?.maxIterations,
      regionCostHits: indexed.discovery.costIndexDiagnostics.hits,
      regionCostMisses: indexed.discovery.costIndexDiagnostics.misses,
      duplicatedPortCount: indexed.discovery.stats.duplicatedPortCount,
      parentIterations: indexedMetrics.iterations })
  }
  console.log("Exact duplicate discovery functional work counts", JSON.stringify(workCounts))
})
