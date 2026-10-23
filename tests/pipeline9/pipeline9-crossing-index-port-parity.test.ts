import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("SRJ18 sample 6 exact crossing index preserves native port paths and budgets including congestion children", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
  const prefix = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  while (!prefix.failed && !prefix.solved && prefix.pipelineDef[prefix.currentPipelineStepIndex]?.solverName !== "portPointPathingSolver") prefix.step()
  expect(prefix.failed).toBeFalse()
  const definition = prefix.pipelineDef[prefix.currentPipelineStepIndex]!
  expect(definition.solverName).toBe("portPointPathingSolver")
  type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  const [params] = definition.getConstructorParams(prefix) as [Params]
  const controlParams = structuredClone(params)
  controlParams.flags.USE_EXACT_CROSSING_INDEX = false
  const indexedParams = structuredClone(params)
  indexedParams.flags.USE_EXACT_CROSSING_INDEX = true
  indexedParams.flags.COLLECT_EXACT_CROSSING_INDEX_WORK = true
  const native = new TinyHypergraphPortPointPathingSolver(controlParams)
  const indexed = new TinyHypergraphPortPointPathingSolver(indexedParams)
  native.solve()
  indexed.solve()
  expect(native.solved).toBeTrue()
  expect(indexed.solved).toBeTrue()
  expect(indexed.failed).toBeFalse()
  expect(indexed.iterations).toBe(native.iterations)
  expect(indexed.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(indexed.getOutput()).toEqual(native.getOutput())
  expect(indexed.computeNodePfMap()).toEqual(native.computeNodePfMap())
  expect(native.benchmarkDiagnosticCounters.crossingIndexBuilds).toBe(0)
  expect(indexed.benchmarkDiagnosticCounters.crossingIndexInstalledSolvers).toBeGreaterThan(1)
  expect(indexed.benchmarkDiagnosticCounters.crossingIndexQueries).toBeGreaterThan(0)
  expect(indexed.benchmarkDiagnosticCounters.crossingIndexReplacedSegmentComparisons).toBeGreaterThan(indexed.benchmarkDiagnosticCounters.crossingIndexWordQueries)
})
