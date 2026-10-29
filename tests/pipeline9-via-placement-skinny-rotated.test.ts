import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { makeSkinnyViaPadUnion } from "./fixtures/skinny-via-pad-union"

test("rotated skinny pad unions follow filled copper rather than enclosing boxes", (): void => {
  const horizontal = makeSkinnyViaPadUnion({ rotation: 90 })
  expect(constrainPipeline9RegionLayerChanges(horizontal)).toBe(1)
  expect(horizontal.graph.regions[0]!.d.layerChangeAllowedNetIds).toEqual(["routing-even", "unknown"])
  expect(horizontal.graph.regions[0]!.d.width).toBe(6)
  expect(horizontal.graph.regions[0]!.d.height).toBe(0.5)

  const oblique = makeSkinnyViaPadUnion()
  oblique.originalSrj.obstacles = [{ type: "rect", center: { x: 0, y: 0 },
    width: 1.5, height: 0.05, ccwRotationDegrees: 45, layers: ["top"], connectedTo: ["pad-even-port"] }]
  oblique.graph.regions[0]!.d.width = 1
  oblique.graph.regions[0]!.d.height = 0.2
  oblique.physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj: oblique.originalSrj,
    routingConnMap: new ConnectivityMap({ "routing-signal": ["signal", "signal-port"] }) })
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: oblique.originalSrj,
    boardObstacles: oblique.originalSrj.obstacles, physicalOwnership: oblique.physicalOwnership,
    layerCount: 4, clearance: 0.1 })
  // This witness lies inside the rotated pad's axis-aligned bounding box.
  expect(validate({ x: 0.5, y: -0.1, zStart: 1, zEnd: 2, viaDiameter: 0.3 }, "signal")).toBe(true)
  expect(constrainPipeline9RegionLayerChanges({ ...oblique, routingNetIds: ["routing-signal"] })).toBe(0)
  expect(oblique.graph.regions[0]!.d.layerChangeAllowedNetIds).toBeUndefined()
})
