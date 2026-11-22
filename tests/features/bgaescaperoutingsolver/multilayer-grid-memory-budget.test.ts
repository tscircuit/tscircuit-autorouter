import { expect, test } from "bun:test"
import { BgaEscapeRoutingSolver } from "lib/solvers/BgaEscapeRoutingSolver/BgaEscapeRoutingSolver"
import type { SimpleRouteJson } from "lib/types"

test("bounds the grid allocation across routing layers and trace widths", () => {
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -40, maxX: 40, minY: -40, maxY: 40 },
    layerCount: 8,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "ADDRESS",
        pointsToConnect: [
          { x: -37, y: -37, layer: "top", pcb_port_id: "source" },
          { x: 37, y: 37, layer: "top", pcb_port_id: "target" },
        ],
      },
    ],
  }
  const solver = new BgaEscapeRoutingSolver({
    inputSrj,
    pointPairs: inputSrj.connections,
    bga: { center: { x: 0, y: 0 }, pitch: 0.4 },
  })
  solver.solve()

  expect(solver.failure).toBe("grid_budget")
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutput()).toThrow()
})
