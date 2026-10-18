import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("invalid rotation cannot silently fall back to unrotated terminal containment", () => {
  for (const rotation of [NaN, Infinity, -Infinity]) {
    const input: SimpleRouteJson = {
      layerCount: 2, minTraceWidth: 0.1,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      obstacles: [{ type: "rect", layers: ["top"], center: { x: 0, y: 0 },
        width: 1, height: 1, ccwRotationDegrees: rotation, connectedTo: ["port"] }],
      connections: [{ name: "net", pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "port" }] }],
    }
    expect(() => addApproximatingRectsToSrj(input)).toThrow("rotation must be finite")
  }
})
