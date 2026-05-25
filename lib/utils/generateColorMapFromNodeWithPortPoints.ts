import { NodeWithPortPoints } from "lib/types/high-density-types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPortPointsFromNodeWithPortPoints } from "./getPortPointsFromNodeWithPortPoints"

export const generateColorMapFromNodeWithPortPoints = (
  nodeWithPortPoints: NodeWithPortPoints,
  connMap?: ConnectivityMap,
) => {
  const colorMap: Record<string, string> = {}
  const portPoints = getPortPointsFromNodeWithPortPoints(nodeWithPortPoints)
  portPoints.forEach((portPoint, i) => {
    colorMap[portPoint.connectionName] =
      `hsl(${(i * 360) / portPoints.length}, 100%, 50%)`
  })
  return colorMap
}
