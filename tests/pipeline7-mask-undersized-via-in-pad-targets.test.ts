import { expect, test } from "bun:test"
import { maskPipeline7UndersizedViaInPadTargets } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/mask-pipeline7-undersized-via-in-pad-targets"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline7 excludes undersized terminal pads from via-in-pad moves", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.45,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_port_small", "source_net_0"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["pcb_port_large", "source_net_0"],
      },
    ],
    connections: [
      {
        name: "source_net_0",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_small" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_large" },
        ],
      },
    ],
  }

  const maskedSrj = maskPipeline7UndersizedViaInPadTargets(srj, 0.45)

  expect(maskedSrj.obstacles[0]?.connectedTo).toEqual(["source_net_0"])
  expect(maskedSrj.obstacles[1]).toBe(srj.obstacles[1])
  expect(srj.obstacles[0]?.connectedTo).toEqual([
    "pcb_port_small",
    "source_net_0",
  ])
})
