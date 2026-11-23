import { expect, test } from "bun:test"
import {
  BgaEscapeRoutingSolver,
  type BgaRoutingBoard,
} from "@tscircuit/high-density-phase-solver"
import { getBgaViaKeepoutObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getBgaViaKeepoutObstacles"
import type { ViaKeepout } from "lib/types/srj-types"
import { isViaInKeepout } from "lib/utils/isViaInKeepout"

test("BGA escape can leave a via-only keepout on the terminal copper layer", (): void => {
  const start = { x: -0.8, y: 0, layer: "top", pcb_port_id: "start" }
  const end = { x: 0.8, y: 0, layer: "top", pcb_port_id: "end" }
  const connection = { name: "signal", pointsToConnect: [start, end] }
  const board: BgaRoutingBoard = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 4,
    minTraceWidth: 0.12,
    traceClearance: 0.08,
    viaToPadClearance: 0.1,
    via: { padDiameter: 0.3, holeDiameter: 0.15 },
    obstacles: [],
    connections: [connection],
    fixedTraces: [],
  }
  const center = { x: start.x, y: start.y }
  const keepouts: ViaKeepout[] = [
    { shape: "circle", center, radius: 0.2, layers: ["top"] },
    { shape: "rect", center, width: 0.4, height: 0.4, layers: ["inner1"] },
    {
      shape: "outline",
      outline: [
        { x: start.x - 0.2, y: -0.2 },
        { x: start.x + 0.2, y: 0.2 },
      ],
      strokeWidth: 0.2,
      layers: ["bottom"],
    },
  ]

  for (const keepout of keepouts) {
    const solver = new BgaEscapeRoutingSolver({
      board: {
        ...board,
        obstacles: getBgaViaKeepoutObstacles([keepout], board.layerCount),
      },
      pointPairs: [connection],
      signalLayers: [0, 1, 2, 3],
      bga: { center: { x: 0, y: 0 }, pitch: 0.8 },
    })
    solver.solve()
    expect(solver.solved, solver.error ?? "").toBe(true)
    const traces = solver.getOutput()
    expect(traces).toHaveLength(1)
    const { route } = traces[0]!
    expect(route[0]).toMatchObject({
      route_type: "wire",
      x: start.x,
      y: start.y,
      layer: start.layer,
      start_pcb_port_id: start.pcb_port_id,
    })
    const firstVia = route.findIndex((point) => point.route_type === "via")
    expect(firstVia).toBeGreaterThan(1)
    const vias = route.filter((point) => point.route_type === "via")
    expect(
      vias.some((via) =>
        isViaInKeepout(via, board.via.padDiameter, [keepout], board.layerCount),
      ),
    ).toBe(false)
  }
})
