import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reduces inherited copper DRCs on SRJ23 benchmark sample 49", async (): Promise<void> => {
  // Use the benchmark's sorted sample ordinal, not an assumed circuit filename.
  const { scenario } = await loadScenarioBySampleNumber("srj23", 49)
  const baseline = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: scenario,
    routedTraces: [],
  })
  expect(baseline.errors).toHaveLength(2)
  expect(
    baseline.errors.every(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    ),
  ).toBeTrue()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const jointRepair = solver.pipeline9JointDrcRepairSolver
  expect(jointRepair).toBeDefined()
  expect(Number(jointRepair?.stats.movablePreloadedTraceCount)).toBeGreaterThan(
    0,
  )
  expect(jointRepair?.stats.exactRepairConfiguredMaxIterations).toBe(32)
  expect(jointRepair?.stats.exactRepairConfiguredViaInPadMaxIterations).toBe(32)
  expect(jointRepair?.stats.exactRepairConfiguredBroadMaxIterations).toBe(12)
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  console.log(
    JSON.stringify({
      dataset: "srj23",
      sample: 49,
      baselineErrors: baseline.errors,
      finalErrors: finalDrc.errors,
      jointRepairStats: jointRepair?.stats,
    }),
  )
  expect(finalDrc.errors.length).toBeLessThan(baseline.errors.length)
})
