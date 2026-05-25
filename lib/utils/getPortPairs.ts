import { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Point3 } from "@tscircuit/math-utils"
import { getPortPointPairsFromNodeWithPortPoints } from "./getPortPointsFromNodeWithPortPoints"

export type PortPairMap = Map<
  string,
  { start: Point3; end: Point3; connectionName: string }
>

export const getPortPairMap = (
  nodeWithPortPoints: NodeWithPortPoints,
): PortPairMap => {
  const portPairMap: PortPairMap = new Map()
  getPortPointPairsFromNodeWithPortPoints(nodeWithPortPoints).forEach(
    ([start, end]) => {
      portPairMap.set(start.connectionName, {
        start,
        end,
        connectionName: start.connectionName,
      })
    },
  )
  return portPairMap
}
