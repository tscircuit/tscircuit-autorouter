import { expect, test } from "bun:test"
import { inferPreloadedTraceConnectivity } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/infer-preloaded-trace-connectivity"
import type { SimpleRouteJson } from "lib/types"

test("infers quantized endpoints through multilayer connected pads", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 1 },
        width: 0.6,
        height: 0.6,
        layers: ["top", "bottom"],
        connectedTo: ["through-hole", "net1"],
      },
    ],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          {
            x: 1,
            y: 1,
            layer: "top",
            pointId: "through-hole",
            pcb_port_id: "through-hole",
          },
          {
            x: 2,
            y: 2,
            layer: "top",
            pointId: "quantized-top",
          },
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "unrelated",
          },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "preloaded-net1",
        connection_name: "net1",
        connectsTo: ["existing"],
        route: [
          {
            route_type: "wire",
            x: 1.0005,
            y: 1.0005,
            width: 0.1,
            layer: "bottom",
          },
          {
            route_type: "wire",
            x: 2.0007,
            y: 2.0007,
            width: 0.1,
            layer: "top",
          },
        ],
      },
    ],
  }

  expect(inferPreloadedTraceConnectivity(srj).traces?.[0]?.connectsTo).toEqual([
    "existing",
    "through-hole",
    "quantized-top",
  ])
})
