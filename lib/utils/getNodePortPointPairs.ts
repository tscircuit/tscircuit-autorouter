import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "./getConnectionPortPointPairs"

export function getNodePortPointPairs(
  node: NodeWithPortPoints,
): [PortPoint, PortPoint][] {
  if (node.portPointsInPairs?.length) return node.portPointsInPairs

  const connections = new Map<PortPoint["connectionName"], PortPoint[]>()
  for (const portPoint of node.portPoints) {
    const points = connections.get(portPoint.connectionName) ?? []
    points.push(portPoint)
    connections.set(portPoint.connectionName, points)
  }
  return Array.from(connections.values()).flatMap(getConnectionPortPointPairs)
}
