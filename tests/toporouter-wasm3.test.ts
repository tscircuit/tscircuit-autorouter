import { test, expect } from "bun:test"
import { ToporouterWasmPipelineSolver } from "lib/autorouter-pipelines/ToporouterWasmPipeline/ToporouterWasmPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("toporouter-wasm: route around obstacle without crash", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }

  const solver = new ToporouterWasmPipelineSolver(srj)
  await solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  console.log("Stats:", solver.stats)
})
