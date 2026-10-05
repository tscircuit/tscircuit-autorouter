import { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Point3 } from "@tscircuit/math-utils"

export type PortPairMap = Map<
  string,
  { start: Point3; end: Point3; connectionName: string }
>

export const getPortPairMap = (
  nodeWithPortPoints: NodeWithPortPoints,
): PortPairMap => {
  const portPairMap: PortPairMap = new Map()
  nodeWithPortPoints.portPoints.forEach((portPoint) => {
    if (!portPairMap.has(portPoint.connectionName)) {
      portPairMap.set(portPoint.connectionName, {
        start: portPoint,
        end: null as any,
        connectionName: portPoint.connectionName,
      })
    } else {
      portPairMap.get(portPoint.connectionName)!.end = portPoint
    }
  })
  return portPairMap
}
