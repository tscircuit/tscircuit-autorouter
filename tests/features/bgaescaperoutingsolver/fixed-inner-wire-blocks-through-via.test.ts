import { expect, test } from "bun:test"
import { BgaRoutingCopper } from "lib/solvers/BgaEscapeRoutingSolver/BgaRoutingCopper"
import { BgaRoutingGrid } from "lib/solvers/BgaEscapeRoutingSolver/BgaRoutingGrid"
import type { SimpleRouteJson } from "lib/types"

test("a fixed inner-layer wire blocks a through drill while leaving the surface clear", () => {
  const center = { x: 0, y: 0 }
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.4,
    obstacles: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "bus_track",
        connection_name: "DATA",
        isFixed: true,
        route: [
          { route_type: "wire", x: -1, y: 0, layer: "inner2", width: 0.12 },
          { route_type: "wire", x: 1, y: 0, layer: "inner2", width: 0.12 },
        ],
      },
    ],
    connections: [
      {
        name: "CLOCK",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
  }
  const grid = new BgaRoutingGrid({
    inputSrj,
    signalLayers: [0, 1, 2, 3],
    bga: { center, pitch: 0.8 },
  })
  const copper = new BgaRoutingCopper(grid, inputSrj)
  const wireMask = copper.wires.get(0.12)!

  expect(wireMask[grid.getCell(center, 0)!]).toBe(0)
  expect(wireMask[grid.getCell(center, 2)!]).toBe(-1)
  expect(copper.canPlaceVia(grid.getCell(center, 0)!, 1)).toBe(false)
  expect(copper.canPlaceVia(grid.getCell({ x: 0, y: 0.8 }, 0)!, 1)).toBe(true)
})
