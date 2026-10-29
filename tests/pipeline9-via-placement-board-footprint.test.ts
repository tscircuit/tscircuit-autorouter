import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("a contained via center cannot waive its circular board footprint or edge clearance", (): void => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, minBoardEdgeClearance: 0,
    obstacles: [], connections: [{ name: "signal", pointsToConnect: [] }] }
  const context = { boardGeometry: srj, boardObstacles: srj.obstacles,
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 }
  const validate = getPipeline9ViaPlacementValidator(context)
  const via = { x: 1 - 0.06966056, y: 0, zStart: 1, zEnd: 2, viaDiameter: 0.3 }
  expect(via.x).toBeLessThan(srj.bounds.maxX)
  expect(validate(via, "signal")).toBe(false)
  expect(validate({ ...via, x: 0.85 }, "signal")).toBe(true)
  expect(validate({ ...via, x: 0.851 }, "signal")).toBe(false)
  expect(validate({ ...via, x: 1.1 }, "signal")).toBe(false)
  const withMargin = getPipeline9ViaPlacementValidator({ ...context,
    boardGeometry: { ...srj, minBoardEdgeClearance: 0.2 }, allowBlindAndBuriedVias: true })
  expect(withMargin({ ...via, x: 0.65 }, "signal")).toBe(true)
  expect(withMargin({ ...via, x: 0.651 }, "signal")).toBe(false)
  expect(withMargin({ ...via, x: 0, y: -0.651 }, "signal")).toBe(false)
  // Board rejection must not conceal malformed manufactured candidate data.
  expect(() => validate({ ...via, x: 2, viaDiameter: NaN }, "signal")).toThrow("Invalid manufactured")
  expect(() => validate({ ...via, x: 2, zEnd: 4 }, "signal")).toThrow("Invalid manufactured")
})
