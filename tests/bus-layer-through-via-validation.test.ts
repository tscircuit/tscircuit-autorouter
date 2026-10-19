import { expect, test } from "bun:test"
import { getBusLayerRoutingError } from "lib/utils/getBusLayerRoutingError"

test("bus wire restrictions allow a through-via barrel to cross inner layers", () => {
  expect(getBusLayerRoutingError({
    srj: {
      layerCount: 4, minTraceWidth: 0.2,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      obstacles: [],
      connections: [{ name: "signal", pointsToConnect: [{ x: -5, y: 0, layer: "top" }, { x: 5, y: 0, layer: "bottom" }] }],
      buses: [{ busId: "OuterOnly", connectionNames: ["signal"], allowedLayers: ["top", "bottom"] }],
    },
    traces: [{
      type: "pcb_trace", pcb_trace_id: "trace", connection_name: "signal",
      route: [
        { route_type: "wire", x: -5, y: 0, layer: "top", width: 0.2 },
        { route_type: "via", x: -5, y: 0, from_layer: "top", to_layer: "bottom", layers: ["top", "inner1", "inner2", "bottom"] },
        { route_type: "wire", x: -5, y: 0, layer: "bottom", width: 0.2 },
        { route_type: "wire", x: 5, y: 0, layer: "bottom", width: 0.2 },
      ],
    }],
  })).toBeUndefined()
})
