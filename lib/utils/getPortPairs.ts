import { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Point3 } from "@tscircuit/math-utils"
import { getNodePortPointPairs } from "./nodeWithPortPointPairs"

export type PortPairMap = Map<
  string,
  {
    start: Point3
    end: Point3
    connectionName: string
    rootConnectionName?: string
  }
>

export const getPortPairMap = (
  nodeWithPortPoints: NodeWithPortPoints,
): PortPairMap => {
  const portPairMap: PortPairMap = new Map()
  getNodePortPointPairs(nodeWithPortPoints).forEach((pair) => {
    portPairMap.set(pair.connectionName, {
      start: pair.start,
      end: pair.end,
      connectionName: pair.connectionName,
      rootConnectionName: pair.rootConnectionName,
    })
  })
  return portPairMap
}
