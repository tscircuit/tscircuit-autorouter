import { expect, test } from "bun:test"
import { getPipeline9PadPointDistance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadPointDistance"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"

test("legacy equal-diameter ovals use true circular copper and ambiguous ovals use inner certificates", () => {
  const circle = { type: "oval", center: { x: 0, y: 0 }, width: 1, height: 1,
    layers: ["top"], connectedTo: ["pad-owner"] } as unknown as Obstacle
  const oval = { ...circle, width: 2, ccwRotationDegrees: 45 }
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [{ name: "signal", pointsToConnect: [{ x: 4, y: 4, layer: "top" }] }],
    obstacles: [circle] }
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: srj, boardObstacles: srj.obstacles,
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 })
  expect(validate({ x: 0.6, y: 0.6, zStart: 0, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(true)
  expect(validate({ x: 0.5, y: 0.5, zStart: 0, zEnd: 3, viaDiameter: 0.3 }, "signal")).toBe(false)
  expect(getPipeline9PadPointDistance({ x: 0.6, y: 0.6 }, circle, "inner"))
    .toBeCloseTo(Math.hypot(0.6, 0.6) - 0.5, 12)
  expect(getPipeline9PadPointDistance({ x: 0.7, y: 0.7 }, oval, "inner"))
    .toBeCloseTo(Math.hypot(0.7, 0.7) - 0.5, 12)
  expect(getPipeline9PadPointDistance({ x: 0.7, y: 0.7 }, oval, "outer"))
    .toBeLessThan(getPipeline9PadPointDistance({ x: 0.7, y: 0.7 }, oval, "inner"))
})
