import { expect, test } from "bun:test"
import { restrictBusConnectionPointLayers } from "lib/utils/busLayerConstraints"

test("a bus cannot silently route a terminal on a forbidden layer", () => {
  expect(() => restrictBusConnectionPointLayers({
    layerCount: 4,
    minTraceWidth: 0.2,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [{ x: -5, y: 0, layer: "inner1" }, { x: 5, y: 0, layer: "top" }] }],
    buses: [{ busId: "OuterOnly", connectionNames: ["signal"], allowedLayers: ["top", "bottom"] }],
  })).toThrow("Bus routing restrictions exclude a connection terminal")
})
