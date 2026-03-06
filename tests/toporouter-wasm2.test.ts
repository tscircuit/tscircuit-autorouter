import { test, expect } from "bun:test"
import { ToporouterWasmPipelineSolver } from "lib/autorouter-pipelines/ToporouterWasmPipeline/ToporouterWasmPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("toporouter-wasm: two crossing nets", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: -3, y: -3, layer: "top" },
          { x: 3, y: 3, layer: "top" },
        ],
      },
      {
        name: "net2",
        pointsToConnect: [
          { x: -3, y: 3, layer: "top" },
          { x: 3, y: -3, layer: "top" },
        ],
      },
    ],
  }

  const solver = new ToporouterWasmPipelineSolver(srj)
  await solver.solve()

  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  console.log(`Routed ${traces.length}/2 nets, stats:`, solver.stats)
  expect(traces.length).toBeGreaterThanOrEqual(1)
})
