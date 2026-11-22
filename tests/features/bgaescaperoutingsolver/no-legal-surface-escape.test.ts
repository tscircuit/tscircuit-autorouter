import { expect, test } from "bun:test"
import { BgaEscapeRoutingSolver } from "lib/solvers/BgaEscapeRoutingSolver/BgaEscapeRoutingSolver"
import type { SimpleRouteJson } from "lib/types"

test("requires a real via site for every terminal before publishing routes", () => {
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    minBoardEdgeClearance: 0.2,
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.4,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1.8,
        height: 1.8,
        layers: ["inner1"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "CLOCK",
        pointsToConnect: [
          { x: -0.4, y: 0, layer: "top", pcb_port_id: "cpu_clock" },
          { x: 0.4, y: 0, layer: "top", pcb_port_id: "ram_clock" },
        ],
      },
    ],
  }
  const solver = new BgaEscapeRoutingSolver({
    inputSrj,
    pointPairs: inputSrj.connections,
    bga: { center: { x: 0, y: 0 }, pitch: 0.8 },
  })
  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failure).toBe("no_via_site")
  expect(solver.error).toContain("cpu_clock")
  expect(() => solver.getOutput()).toThrow()
})
