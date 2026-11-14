import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../lib/types/srj-types"

test("a foreign net's existing multilayer contact cannot bypass the via prohibition", () => {
  const keepout = true
  const input = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        obstacleId: "platedhole",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top", "bottom"],
        connectedTo: ["hole"],
      },
    ],
    connections: [
      {
        name: "A",
        __rootConnectionNames: ["N"],
        pointsToConnect: [
          { x: -3, y: 0, layer: "top", pcb_port_id: "a" },
          { x: 3, y: 0, layer: "bottom", pcb_port_id: "b" },
        ],
      },
      {
        name: "B",
        __rootConnectionNames: ["M"],
        pointsToConnect: [
          { x: 0, y: 0, layers: ["top", "bottom"], pcb_port_id: "hole" },
          { x: -3, y: 2, layer: "top", pcb_port_id: "c" },
        ],
      },
    ],
    ...(keepout
      ? {
          viaKeepouts: [
            {
              shape: "rect",
              center: { x: 0, y: 0 },
              width: 10,
              height: 10,
              layers: ["top", "bottom"],
            },
          ],
        }
      : {}),
  }

  const solver = new Pipeline(input as SimpleRouteJson, {
    effort: 0.1,
    cacheProvider: null,
    maxNodeDimension: 3,
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.getCurrentPhase()).toBe("portPointPathingSolver")
})
