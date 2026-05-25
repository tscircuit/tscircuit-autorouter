import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getPortPointsFromNodeWithPortPoints } from "./getPortPointsFromNodeWithPortPoints"

export const toHighDensityRepair01NodeWithPortPoints = (
  node: NodeWithPortPoints,
) => ({
  ...node,
  portPoints: getPortPointsFromNodeWithPortPoints(node),
})

export const toHighDensityRepair01NodesWithPortPoints = (
  nodes: NodeWithPortPoints[],
) => nodes.map(toHighDensityRepair01NodeWithPortPoints)
