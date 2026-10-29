import { expect, test } from "bun:test"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { makeSkinnyViaPadUnion } from "./fixtures/skinny-via-pad-union"

test("an off-center gap in a skinny pad union leaves through-via travel unrestricted", (): void => {
  const fixture = makeSkinnyViaPadUnion({ omittedPadIndices: [7, 8] })
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: fixture.originalSrj,
    boardObstacles: fixture.originalSrj.obstacles, physicalOwnership: fixture.physicalOwnership,
    layerCount: 4, clearance: 0.1 })
  expect(validate({ x: 0, y: 0, zStart: 1, zEnd: 2, viaDiameter: 0.3 }, "signal")).toBe(false)
  expect(validate({ x: 0, y: 1, zStart: 1, zEnd: 2, viaDiameter: 0.3 }, "signal")).toBe(true)
  expect(constrainPipeline9RegionLayerChanges(fixture)).toBe(0)
  expect(fixture.graph.regions[0]!.d.layerChangeAllowedNetIds).toBeUndefined()
})
