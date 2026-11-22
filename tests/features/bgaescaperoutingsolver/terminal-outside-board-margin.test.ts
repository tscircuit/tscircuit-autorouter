import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { BgaEscapeRoutingSolver } from "lib/solvers/BgaEscapeRoutingSolver/BgaEscapeRoutingSolver"

test("explains an unreachable terminal outside the board-edge routing margin", () => {
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.4,
    minBoardEdgeClearance: 0.2,
    obstacles: [],
    connections: [
      {
        name: "CLOCK",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "cpu_clock" },
          { x: 1.9, y: 0, layer: "top", pcb_port_id: "ram_clock" },
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

  expect(solver.failure).toBe("terminal_outside_grid")
  expect(solver.error).toContain("ram_clock")
  expect(solver.solved).toBe(false)
})
