import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

const pointKey = (portPoint: PortPoint) =>
  [
    portPoint.rootConnectionName ?? portPoint.connectionName,
    portPoint.x.toFixed(6),
    portPoint.y.toFixed(6),
    portPoint.z ?? 0,
  ].join(":")

export const dedupeSameRootPortPoints = (
  nodes: NodeWithPortPoints[],
): NodeWithPortPoints[] =>
  nodes.map((node) => {
    const seenPortPointKeys = new Set<string>()
    const portPoints = node.portPoints.filter((portPoint) => {
      const key = pointKey(portPoint)
      if (seenPortPointKeys.has(key)) {
        return false
      }
      seenPortPointKeys.add(key)
      return true
    })

    return portPoints.length === node.portPoints.length
      ? node
      : {
          ...node,
          portPoints,
        }
  })
