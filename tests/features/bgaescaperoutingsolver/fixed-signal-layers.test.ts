import { expect, test } from "bun:test"
import { getBgaSignalLayers } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getBgaSignalLayers"
import type { SimpleRouteJson } from "lib/types"

test("uses surface terminals and fixed wire segments to identify signal layers", () => {
  const input: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.127,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "CLOCK",
        pointsToConnect: [
          { x: 1, y: 1, layer: "bottom" },
          { x: -1, y: -1, layer: "top" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "data",
        connection_name: "DATA",
        isFixed: true,
        route: [
          { route_type: "wire", x: -1, y: 0, layer: "inner4", width: 0.127 },
          { route_type: "wire", x: 0, y: 0, layer: "inner4", width: 0.127 },
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "inner4",
            to_layer: "inner1",
          },
          { route_type: "wire", x: 0, y: 0, layer: "inner1", width: 0.127 },
          { route_type: "wire", x: 0, y: 0, layer: "inner1", width: 0.127 },
        ],
      },
    ],
  }

  expect(getBgaSignalLayers(input)).toEqual([0, 4, 7])
})
