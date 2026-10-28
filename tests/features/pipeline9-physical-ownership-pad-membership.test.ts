import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership, getPipeline9PhysicalObstacleOwner, getPipeline9PhysicalRouteOwner } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("original same-pad membership proves aliases without coordinate inference", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    connections: [
      { name: "request-a", pointsToConnect: [{ x: -4, y: 0, layer: "top", pointId: "point-a", pcb_port_id: "port-a" }] },
      { name: "request-b", pointsToConnect: [{ x: 4, y: 0, layer: "top", pointId: "point-b", pcb_port_id: "port-b" }] },
    ],
    obstacles: [{ obstacleId: "shared-pad", type: "rect", center: { x: 9, y: 9 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["request-a", "request-b", "legacy-pad-alias"] }],
  }
  const derived = { name: "pair", __rootConnectionNames: ["request-a", "request-b"], pointsToConnect: [originalSrj.connections[0]!.pointsToConnect[0]!, originalSrj.connections[1]!.pointsToConnect[0]!] }
  const connMap = getConnectivityMapFromSimpleRouteJson({ ...originalSrj, connections: [...originalSrj.connections, derived] })
  const context = getPipeline9PhysicalOwnership({ originalSrj, derivedConnections: [derived], routingConnMap: connMap })
  const physicalOwnership = JSON.parse(JSON.stringify(context))
  const owner = getPipeline9PhysicalRouteOwner(physicalOwnership, { connectionName: "request-a" })
  expect(owner).toBeDefined()
  expect(getPipeline9PhysicalRouteOwner(physicalOwnership, { connectionName: "request-b" })).toBe(owner)
  expect(getPipeline9PhysicalRouteOwner(physicalOwnership, { connectionName: "pair" })).toBe(owner)
  expect(getPipeline9PhysicalObstacleOwner(physicalOwnership, { ...originalSrj.obstacles[0]!, connectedTo: ["unregistered-derived-owner"] })).toBe(owner)
  expect(context.diagnostics.ambiguousDerivedAliases).toEqual([])
})
