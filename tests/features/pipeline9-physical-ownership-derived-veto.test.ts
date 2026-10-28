import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership, getPipeline9PhysicalObstacleOwner, getPipeline9PhysicalRouteOwner } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { SimpleRouteJson } from "lib/types"

test("derived aliases and cross-field literals cannot union original owners", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    connections: [
      { name: "alias", pointsToConnect: [{ x: -4, y: 0, layer: "top", pointId: "point-a", pcb_port_id: "port-a" }] },
      { name: "other", pointsToConnect: [{ x: 4, y: 0, layer: "top", pointId: "point-b", pcb_port_id: "alias" }] },
    ],
    obstacles: [{ obstacleId: "ambiguous-pad", type: "rect", center: { x: 9, y: 9 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["alias"] }],
  }
  const context = getPipeline9PhysicalOwnership({
    originalSrj,
    derivedConnections: [
      { name: "foreign-merge", __rootConnectionNames: ["alias", "other"], pointsToConnect: [] },
      { name: "alias_mst_unknown", pointsToConnect: [] },
    ],
  })
  const a = getPipeline9PhysicalRouteOwner(context, { connectionName: "alias" })
  const b = getPipeline9PhysicalRouteOwner(context, { connectionName: "other" })
  expect(a).toBeDefined()
  expect(b).toBeDefined()
  expect(a).not.toBe(b)
  expect(context.aliasOwners.alias).toBeNull()
  expect(getPipeline9PhysicalObstacleOwner(context, originalSrj.obstacles[0]!)).not.toBe(a)
  expect(getPipeline9PhysicalRouteOwner(context, { connectionName: "foreign-merge" })).toBeUndefined()
  expect(getPipeline9PhysicalRouteOwner(context, { connectionName: "alias_mst_unknown" })).toBeUndefined()
  expect(context.diagnostics.ambiguousDerivedAliases).toContain("foreign-merge")
  expect(context.diagnostics.unknownDerivedAliases).toContain("alias_mst_unknown")
})
