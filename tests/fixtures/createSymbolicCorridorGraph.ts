import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

export function createSymbolicCorridorGraph(): SerializedHyperGraph {
  const regions = [-3, -1, 1, 3].map((x, i) => ({ regionId: `r${i}`, pointIds: [] as string[], d: { capacityMeshNodeId: `r${i}`, center: { x, y: 0 }, width: 2, height: 4, availableZ: [0], _containsTarget: i === 0 || i === 3 } }))
  const ports: SerializedHyperGraph["ports"] = []
  for (let edge = 0; edge < 3; edge++) for (let lane = 0; lane < 4; lane++) {
    const portId = `e${edge}p${lane}`
    ports.push({ portId, region1Id: `r${edge}`, region2Id: `r${edge + 1}`, d: { portId, x: -2 + 2 * edge, y: -1.5 + lane, z: 0 } })
    regions[edge]!.pointIds.push(portId); regions[edge + 1]!.pointIds.push(portId)
  }
  const connections = ["A", "B"].map((name, i) => {
    const y = i === 0 ? 0.5 : -0.5
    for (const endpoint of ["start", "end"] as const) {
      const portId = `tiny-terminal:${endpoint}-port:${name}`
      const regionId = `tiny-terminal:${endpoint}-region:${name}`
      const owner = endpoint === "start" ? 0 : 3
      ports.push({ portId, region1Id: `r${owner}`, region2Id: regionId, d: { portId, x: endpoint === "start" ? -4 : 4, y, z: 0, _tinyTerminal: true } })
      regions[owner]!.pointIds.push(portId)
      regions.push({ regionId, pointIds: [portId], d: { capacityMeshNodeId: regionId, center: { x: endpoint === "start" ? -4 : 4, y }, width: 0.001, height: 0.001, availableZ: [0], _containsTarget: true } })
    }
    return { connectionId: name, mutuallyConnectedNetworkId: name, startRegionId: "r0", endRegionId: "r3", simpleRouteConnection: { name, pointsToConnect: [{ x: -4, y, layer: "top" }, { x: 4, y, layer: "top" }] } }
  })
  return { regions, ports, connections, solvedRoutes: connections.map((connection) => ({ connection, requiredRip: false, path: [{ portId: `tiny-terminal:start-port:${connection.connectionId}`, g: 0, h: 0, f: 0, hops: 0, ripRequired: false }, { portId: `tiny-terminal:end-port:${connection.connectionId}`, g: 0, h: 0, f: 0, hops: 0, ripRequired: false }] })) } as SerializedHyperGraph
}
