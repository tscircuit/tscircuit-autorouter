import type {
  NodeWithPortPoints,
  PortPoint,
  PortPointInPair,
} from "lib/types/high-density-types"

export const getPortPointPairsFromNodeWithPortPoints = (
  nodeWithPortPoints: NodeWithPortPoints,
): PortPointInPair[] => nodeWithPortPoints.portPointsInPairs

export const getPortPointsFromNodeWithPortPoints = (
  nodeWithPortPoints: NodeWithPortPoints,
): PortPoint[] => nodeWithPortPoints.portPointsInPairs.flat()

export const createPortPointPairsFromPortPoints = (
  inputPortPoints: Array<Omit<PortPoint, "z"> & { z?: number }>,
): PortPointInPair[] => {
  const portPointsByConnectionName = new Map<string, PortPoint[]>()
  for (const inputPortPoint of inputPortPoints) {
    const portPoint = { ...inputPortPoint, z: inputPortPoint.z ?? 0 }
    const portPoints =
      portPointsByConnectionName.get(portPoint.connectionName) ?? []
    portPoints.push(portPoint)
    portPointsByConnectionName.set(portPoint.connectionName, portPoints)
  }

  const portPointPairs: PortPointInPair[] = []
  for (const portPoints of portPointsByConnectionName.values()) {
    for (let i = 0; i + 1 < portPoints.length; i += 2) {
      portPointPairs.push([portPoints[i]!, portPoints[i + 1]!])
    }
  }

  return portPointPairs
}
