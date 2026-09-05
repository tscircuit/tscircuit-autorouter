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
  const route = solver.getOutputSimplifiedPcbTraces().find((trace) => {
    const end = trace.route.at(-1)
    return end?.route_type === "wire" && end.x === -7.175 && end.y === 16.51
  })!
  expect(route).toBeDefined()
  // This route goes left from its first terminal to its last. Previously it
  // reversed by 0.83 mm above the pads, leaving a visible retraced spur.
  for (let i = 1; i < route.route.length; i++) {
    const previous = route.route[i - 1]!
    const point = route.route[i]!
    expect(point.route_type).toBe("wire")
    if (point.route_type === "wire" && previous.route_type === "wire") {
      expect(point.x).toBeLessThanOrEqual(previous.x)
    }
  }
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toEqual([])
})
