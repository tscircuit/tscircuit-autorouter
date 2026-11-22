import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { BgaEscapeRoutingSolver } from "lib/solvers/BgaEscapeRoutingSolver/BgaEscapeRoutingSolver"

test("reports both terminals when a keepout separates their legal escape vias", () => {
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.4,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 2,
        layers: ["top", "inner1", "inner2", "bottom"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "CLOCK",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "cpu_clock" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "ram_clock" },
        ],
      },
    ],
  }
  const solver = new BgaEscapeRoutingSolver({
    inputSrj,
    pointPairs: inputSrj.connections,
    signalLayers: [0, 1, 2, 3],
    bga: { center: { x: 0, y: 0 }, pitch: 0.8 },
  })
  solver.solve()

  expect(solver.failure).toBe("no_path")
  expect(solver.error).toContain("cpu_clock to ram_clock")
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutput()).toThrow()
})
