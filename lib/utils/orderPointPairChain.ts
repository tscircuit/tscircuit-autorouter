import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"
import { getConnectionPointLayers } from "./connection-point-utils"

type ChainVertex = {
  point: ConnectionPoint
  connections: SimpleRouteConnection[]
}

function pointsShareTerminal(a: ConnectionPoint, b: ConnectionPoint): boolean {
  if (a.pcb_port_id && b.pcb_port_id) return a.pcb_port_id === b.pcb_port_id
  if (a.pointId && b.pointId) return a.pointId === b.pointId
  return (
    a.x === b.x &&
    a.y === b.y &&
    getConnectionPointLayers(a).some((layer) =>
      getConnectionPointLayers(b).includes(layer),
    )
  )
}

/** Points use board coordinates in mm (+X right, +Y up); identities join terminals. */
export function orderPointPairChain(connections: SimpleRouteConnection[]): {
  connections: SimpleRouteConnection[]
  start: ConnectionPoint
  end: ConnectionPoint
} {
  const vertices: ChainVertex[] = []
  const endpoints = new Map<SimpleRouteConnection, ChainVertex[]>()
  for (const connection of connections) {
    if (connection.pointsToConnect.length !== 2)
      throw new Error("Differential pair chain requires point-pair connections")
    const terminals: ChainVertex[] = []
    for (const point of connection.pointsToConnect) {
      let vertex = vertices.find((candidate) =>
        pointsShareTerminal(candidate.point, point),
      )
      if (!vertex) {
        vertex = { point, connections: [] }
        vertices.push(vertex)
      }
      vertex.connections.push(connection)
      terminals.push(vertex)
    }
    endpoints.set(connection, terminals)
  }
  const leaves = vertices.filter((vertex) => vertex.connections.length === 1)
  if (
    leaves.length !== 2 ||
    vertices.some((vertex) => vertex.connections.length > 2)
  )
    throw new Error("Differential pair member must form one unbranched path")

  const ordered: SimpleRouteConnection[] = []
  const visited = new Set<SimpleRouteConnection>()
  let current = leaves[0]!
  while (true) {
    const connection = current.connections.find(
      (candidate) => !visited.has(candidate),
    )
    if (!connection) break
    visited.add(connection)
    ordered.push(connection)
    const next = endpoints.get(connection)!.find((vertex) => vertex !== current)
    if (!next)
      throw new Error("Differential pair chain contains a self connection")
    current = next
  }
  if (ordered.length !== connections.length || current !== leaves[1])
    throw new Error("Differential pair member must form one connected path")
  return { connections: ordered, start: leaves[0]!.point, end: current.point }
}
