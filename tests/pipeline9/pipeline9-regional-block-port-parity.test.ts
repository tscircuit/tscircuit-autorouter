import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("actual SRJ18 sample6 block pruning preserves native port paths, metadata, budgets and stable stats", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
  const prefix = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  while (!prefix.failed && !prefix.solved && prefix.pipelineDef[prefix.currentPipelineStepIndex]?.solverName !== "portPointPathingSolver") prefix.step()
  expect(prefix.failed).toBeFalse()
  type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  const [params] = prefix.pipelineDef[prefix.currentPipelineStepIndex]!.getConstructorParams(prefix) as [Params]
  expect(params.flags.USE_REGIONAL_BLOCK_PRUNING).toBeTrue()
  const nativeParams = structuredClone(params)
  nativeParams.flags.USE_REGIONAL_BLOCK_PRUNING = false
  nativeParams.flags.COLLECT_REGIONAL_BLOCK_WORK = Boolean(process.env.PROFESSIONAL_PORT_PROBE_OUTPUT)
  const optimizedParams = structuredClone(params)
  optimizedParams.flags.COLLECT_REGIONAL_BLOCK_WORK = true
  const native = new TinyHypergraphPortPointPathingSolver(nativeParams)
  const optimized = new TinyHypergraphPortPointPathingSolver(optimizedParams)
  native.solve()
  optimized.solve()
  expect(native.solved).toBeTrue(); expect(optimized.solved).toBeTrue()
  expect(optimized.failed).toBeFalse()
  expect(optimized.iterations).toBe(native.iterations)
  expect(optimized.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(optimized.getOutput()).toEqual(native.getOutput())
  expect(optimized.computeNodePfMap()).toEqual(native.computeNodePfMap())
  const stats = [structuredClone(native.stats), structuredClone(optimized.stats)]
  for (const item of stats) for (const stage of Object.values(item.stageStats as Record<string, { timeSpent?: number }>)) delete stage.timeSpent
  expect(stats[1]).toEqual(stats[0])
  const counters = optimized.benchmarkDiagnosticCounters
  expect(counters.regionalBlockInstalledSolvers).toBeGreaterThan(1)
  expect(counters.regionalBlockPrunedOccurrences).toBeGreaterThan(0)
  if (process.env.PROFESSIONAL_PORT_PROBE_OUTPUT) {
    await Bun.write(process.env.PROFESSIONAL_PORT_PROBE_OUTPUT, JSON.stringify({
      purpose: "Non-timing actual-domain correctness and operation probe; no speed claim",
      sample: "srj18:6", base: "b9d32a05c76af701d518f6a78a3114e68addd144",
      nativeSolved: native.solved, optimizedSolved: optimized.solved,
      nativeIterations: native.iterations, optimizedIterations: optimized.iterations,
      nativeOutputSha256: createHash("sha256").update(JSON.stringify(native.getOutput())).digest("hex"),
      optimizedOutputSha256: createHash("sha256").update(JSON.stringify(optimized.getOutput())).digest("hex"),
      counters,
      nativeCounters: native.benchmarkDiagnosticCounters,
      qualification: "Pruned occurrences are helper-frontier linked skips, potentially including closed occurrences native already removed. Actual native observed occurrences are counted separately, not inferred. Metadata/hop-build/max-refresh/dirty-update work is additional and reported. Typed payload bytes exclude JS block/array/Map/Set allocations. Exact full port output and stable statistics match; no full-board physical or local performance claim.",
    }, null, 2))
  }
})
