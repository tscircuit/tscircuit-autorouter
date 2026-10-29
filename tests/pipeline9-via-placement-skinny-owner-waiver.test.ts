import { expect, test } from "bun:test"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { makeSkinnyViaPadUnion } from "./fixtures/skinny-via-pad-union"

test("waiving either alternating pad owner exposes a legal center in a skinny union", (): void => {
  const fixture = makeSkinnyViaPadUnion({ alternatingOwners: true })
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: fixture.originalSrj,
    boardObstacles: fixture.originalSrj.obstacles, physicalOwnership: fixture.physicalOwnership,
    layerCount: 4, clearance: 0.1 })
  for (const [connectionName, y] of [["pad-even", -1.75], ["pad-odd", -1.25]] as const) {
    expect(validate({ x: 0, y, zStart: 1, zEnd: 2, viaDiameter: 0.3 }, connectionName)).toBe(true)
    expect(validate({ x: 0, y, zStart: 1, zEnd: 2, viaDiameter: 0.3 }, "signal")).toBe(false)
  }
  expect(constrainPipeline9RegionLayerChanges(fixture)).toBe(1)
  expect(fixture.graph.regions[0]!.d.layerChangeAllowedNetIds).toEqual([
    "routing-even", "routing-odd", "unknown",
  ])
})
