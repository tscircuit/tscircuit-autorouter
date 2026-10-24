import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("actual default SRJ18 port stage preserves exact native paths, endpoint metadata and search clock", async (): Promise<void> => {
  const sample = Number(process.env.GEOMETRIC_PARITY_SAMPLE ?? 6)
  const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
  const prefix = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1 })
  while (!prefix.failed && !prefix.solved && prefix.pipelineDef[prefix.currentPipelineStepIndex]?.solverName !== "portPointPathingSolver") prefix.step()
  expect(prefix.failed).toBeFalse()
  type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  const [params] = prefix.pipelineDef[prefix.currentPipelineStepIndex]!.getConstructorParams(prefix) as [Params]
  expect(params.flags.USE_GEOMETRIC_REGIONAL_DOMINANCE).toBeTrue()
  const nativeParams = structuredClone(params)
  nativeParams.flags.USE_GEOMETRIC_REGIONAL_DOMINANCE = false
  const optimizedParams = structuredClone(params)
  optimizedParams.flags.COLLECT_GEOMETRIC_DOMINANCE_WORK = true
  const native = new TinyHypergraphPortPointPathingSolver(nativeParams)
  const optimized = new TinyHypergraphPortPointPathingSolver(optimizedParams)
  native.solve(); optimized.solve()
  expect(native.solved).toBeTrue(); expect(optimized.solved).toBeTrue()
  expect(optimized.failed).toBeFalse()
  expect(optimized.iterations).toBe(native.iterations)
  expect(optimized.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(optimized.getOutput()).toEqual(native.getOutput())
  expect(optimized.computeNodePfMap()).toEqual(native.computeNodePfMap())
  const stats = [structuredClone(native.stats), structuredClone(optimized.stats)]
  for (const item of stats) for (const stage of Object.values(item.stageStats as Record<string, { timeSpent?: number }>)) delete stage.timeSpent
  expect(stats[1]).toEqual(stats[0])
  expect(optimized.benchmarkDiagnosticCounters.coneInstalledSolvers).toBeGreaterThan(0)
  expect(optimized.benchmarkDiagnosticCounters.coneDominatedExpansions).toBeGreaterThan(0)
  if (process.env.GEOMETRIC_PARITY_OUTPUT) await Bun.write(process.env.GEOMETRIC_PARITY_OUTPUT, JSON.stringify({
    purpose: "Non-timing actual default input functional parity and mechanism observation; no speed claim",
    sample: `srj18:${sample}`, base: "b9d32a05c76af701d518f6a78a3114e68addd144",
    nativeSolved: native.solved, optimizedSolved: optimized.solved,
    nativeIterations: native.iterations, optimizedIterations: optimized.iterations,
    nativeOutputSha256: createHash("sha256").update(JSON.stringify(native.getOutput())).digest("hex"),
    optimizedOutputSha256: createHash("sha256").update(JSON.stringify(optimized.getOutput())).digest("hex"),
    counters: optimized.benchmarkDiagnosticCounters,
    limits: "Full port-stage output+stable stats only; final physical pipeline quality and Blacksmith timing remain untested. Query counters default off. No equality or goal pruning.",
  }, null, 2))
})
