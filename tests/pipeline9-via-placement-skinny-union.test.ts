import { expect, test } from "bun:test"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { makeSkinnyViaPadUnion } from "./fixtures/skinny-via-pad-union"

test("a skinny region fully covered by separate pad shadows excludes foreign through vias", (): void => {
  const fixture = makeSkinnyViaPadUnion()
  const original = structuredClone(fixture.originalSrj)
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: fixture.originalSrj,
    boardObstacles: fixture.originalSrj.obstacles, physicalOwnership: fixture.physicalOwnership,
    layerCount: 4, clearance: 0.1 })
  // Every vertical half-pitch is at most 0.05 mm outside the nearest filled
  // rectangle, throughout the full 0.5 mm region width.
  for (let index = 0; index <= 24; index++) {
    for (const x of [-0.25, 0, 0.25]) {
      expect(validate({ x, y: -3 + index * 0.25, zStart: 1, zEnd: 2, viaDiameter: 0.3 }, "signal")).toBe(false)
    }
  }
  expect(constrainPipeline9RegionLayerChanges(fixture)).toBe(1)
  expect(fixture.graph.regions[0]!.d.layerChangeAllowedNetIds).toEqual(["routing-even", "unknown"])
  expect(fixture.graph.regions[0]!.d.availableZ).toEqual([1])
  expect(fixture.graph.regions[0]!.d.width).toBe(0.5)
  expect(fixture.graph.regions[0]!.d.height).toBe(6)
  expect(fixture.originalSrj).toEqual(original)
})
