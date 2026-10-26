import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

export type MultiHeadPortPair = {
  start: PortPoint
  end: PortPoint
  connectionName: string
}

/** Keep routing events separate from their original electrical connection IDs. */
export function getMultiHeadPortPairs(
  node: NodeWithPortPoints,
): Map<string, MultiHeadPortPair> {
  let pairs = node.portPointsInPairs
  if (!pairs?.length) {
    const grouped = new Map<string, PortPoint[]>()
    for (const point of node.portPoints) {
      const points = grouped.get(point.connectionName) ?? []
      points.push(point)
      grouped.set(point.connectionName, points)
    }
    pairs = [...grouped.values()].flatMap(getConnectionPortPointPairs)
  }
  return new Map(
    pairs.map(([start, end], index) => {
      if (start.connectionName !== end.connectionName)
        throw new Error("A MultiHead port pair has conflicting connection IDs")
      return [String(index), { start, end, connectionName: start.connectionName }]
    }),
  )
}
