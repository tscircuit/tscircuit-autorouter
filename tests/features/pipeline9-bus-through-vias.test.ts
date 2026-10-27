import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createBusLayerInput, createBusLayerTrace } from "../fixtures/bus-layer-input"

test("Pipeline9 permits a bus via barrel through an excluded intermediate layer", (): void => {
  const srj = createBusLayerInput()
  srj.traces = [createBusLayerTrace("inner2")]
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { cacheProvider: null })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getOutputSimpleRouteJson().traces).toEqual(srj.traces)
})
