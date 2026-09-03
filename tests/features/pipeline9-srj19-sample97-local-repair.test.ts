import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs every high-density node in SRJ19 sample 97", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj19", 97)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const repairSolver = solver.highDensityRepairSolver
  if (!repairSolver || !solver.srjWithPointPairs) {
    throw new Error("Pipeline9 did not complete high-density repair")
  }
  expect(repairSolver.sampleEntries.length).toBeGreaterThan(0)
  expect(repairSolver.stats.repairedNodeCount).toBe(
    repairSolver.sampleEntries.length,
  )
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toEqual([])
})
