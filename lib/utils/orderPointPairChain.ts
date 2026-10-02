import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"
import { getConnectionPointLayers } from "./connection-point-utils"

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
  const terminals = connections.flatMap((connection) => {
    if (connection.pointsToConnect.length !== 2)
      throw new Error("Differential pair chain requires point-pair connections")
    return connection.pointsToConnect
  })
  const leaves = terminals.filter(
    (point) =>
      terminals.filter((other) => pointsShareTerminal(point, other)).length ===
      1,
  )
  if (leaves.length !== 2)
    throw new Error("Differential pair member must form one unbranched path")

  const remaining = new Set(connections)
  const ordered: SimpleRouteConnection[] = []
  let current = leaves[0]!
  while (remaining.size > 0) {
    const matches = [...remaining].filter((connection) =>
      connection.pointsToConnect.some((point) =>
        pointsShareTerminal(point, current),
      ),
    )
    if (matches.length !== 1)
      throw new Error(
        "Differential pair member must form one connected, unbranched path",
      )
    const connection = matches[0]!
    const next = connection.pointsToConnect.find(
      (point) => !pointsShareTerminal(point, current),
    )
    if (!next)
      throw new Error("Differential pair chain contains a self connection")
    ordered.push(connection)
    remaining.delete(connection)
    current = next
  }
  return { connections: ordered, start: leaves[0]!, end: current }
}
