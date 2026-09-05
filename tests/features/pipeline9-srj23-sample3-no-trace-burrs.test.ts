import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 SRJ23 sample 3 removes the collinear spur above the terminal pads", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 3)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  const route = solver
    .pipeline9JointDrcRepairSolver!.getOutput()
    .find((route) => route.connectionName === "source_net_7_mst0")!
  expect(route).toBeDefined()
  // This route goes left from its first terminal to its last. Previously it
  // reversed by 0.83 mm above the pads, leaving a visible retraced spur.
  for (let i = 1; i < route.route.length; i++) {
    expect(route.route[i]!.x).toBeLessThanOrEqual(route.route[i - 1]!.x)
  }
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toEqual([])
})
