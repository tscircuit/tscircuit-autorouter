import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline7 completes with congestion search enabled and preserves input", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [
      { x: 1, y: 2, layer: "top" }, { x: 9, y: 8, layer: "top" },
    ] }],
  }
  const baseline = structuredClone(input)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.portPointPathingSolver?.congestionReroutingSolver?.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(1)
  expect(input).toEqual(baseline)
})
