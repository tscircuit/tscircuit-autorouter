import { expect, test } from "bun:test"
import { getBusLayerRoutingError } from "lib/utils/getBusLayerRoutingError"

test("final bus validation rejects an inner-layer wire introduced after routing", () => {
  expect(getBusLayerRoutingError({
    srj: {
      layerCount: 4, minTraceWidth: 0.2,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      obstacles: [],
      connections: [{ name: "signal", pointsToConnect: [{ x: -5, y: 0, layer: "top" }, { x: 5, y: 0, layer: "top" }] }],
      buses: [{ busId: "OuterOnly", connectionNames: ["signal"], allowedLayers: ["top", "bottom"] }],
    },
    traces: [{
      type: "pcb_trace", pcb_trace_id: "trace", connection_name: "signal",
      route: [{ route_type: "wire", x: -5, y: 0, layer: "inner1", width: 0.2 }, { route_type: "wire", x: 5, y: 0, layer: "inner1", width: 0.2 }],
    }],
  })).toBe("Routed signal violates the bus's allowed PCB layers")
})
