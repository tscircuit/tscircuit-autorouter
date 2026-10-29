import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("via footprints respect original circles and rotated rectangles", () => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [{ name: "signal", pointsToConnect: [{ x: -4, y: 0, layer: "inner1" }] }],
    obstacles: [
      { type: "rect", shape: "circle", center: { x: 0, y: 0 }, width: 1, height: 1,
        layers: ["top"], connectedTo: ["circle-owner"] },
      { type: "rect", center: { x: 3, y: 0 }, width: 2, height: 0.4,
        ccwRotationDegrees: 90, layers: ["bottom"], connectedTo: ["rectangle-owner"] },
    ],
  }
  const validator = getPipeline9ViaPlacementValidator({ boardGeometry: srj, boardObstacles: srj.obstacles,
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 })
  const placement = { x: 0.749, y: 0, zStart: 1, zEnd: 2, viaDiameter: 0.3 }
  expect(validator(placement, "signal")).toBe(false)
  expect(validator({ ...placement, x: 0.751 }, "signal")).toBe(true)
  expect(validator({ ...placement, x: 3.449 }, "signal")).toBe(false)
  expect(validator({ ...placement, x: 3.451 }, "signal")).toBe(true)
  expect(validator({ ...placement, x: 3, y: 1.249 }, "signal")).toBe(false)
  expect(validator({ ...placement, x: 3, y: 1.251 }, "signal")).toBe(true)
})
