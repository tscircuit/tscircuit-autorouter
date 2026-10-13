import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver6 } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarios } from "scripts/benchmark/scenarios"

test("octagonal pipeline routes dataset01 circuit003 with zero relaxed DRC errors", async () => {
  const scenarios = await loadScenarios("dataset01")
  const input = scenarios.find(([name]) => name === "circuit003")?.[1]
  if (!input) throw new Error("Missing dataset01 circuit003")
  const solver = new AutoroutingPipelineSolver6(input, { polyRegionShape: "octagonal" })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(19)
  expect(evaluateRelaxedDrc({ inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces }).errors).toEqual([])
})
