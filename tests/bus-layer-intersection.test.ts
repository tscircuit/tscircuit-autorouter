import { expect, test } from "bun:test"
import { getAllowedZByConnection } from "lib/utils/getAllowedZByConnection"

test("split connections retain the intersection of their root bus layers", () => {
  const allowedZ = getAllowedZByConnection({
    layerCount: 4,
    minTraceWidth: 0.2,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [],
    connections: [{ name: "pair", __rootConnectionNames: ["signal"], pointsToConnect: [{ x: -5, y: 0, layer: "top" }, { x: 5, y: 0, layer: "top" }] }],
    buses: [
      { busId: "OuterOnly", connectionNames: ["signal"], allowedLayers: ["top", "bottom"] },
      { busId: "NoBottom", connectionNames: ["signal"], allowedLayers: ["top", "inner1"] },
    ],
  })
  expect(allowedZ.get("pair")).toEqual([0])
})
