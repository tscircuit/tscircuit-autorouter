import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

const getAvailableZ = (node: NodeWithPortPoints): number[] => {
  if (node.availableZ?.length) {
    return [...new Set(node.availableZ)].sort((a, b) => a - b)
  }
  return [...new Set(node.portPoints.map((point) => point.z ?? 0))].sort(
    (a, b) => a - b,
  )
}

export const hasImpossibleSameLayerCrossingGeometry = (
  node: NodeWithPortPoints,
  connMap?: ConnectivityMap,
): boolean =>
  getAvailableZ(node).length === 1 &&
  getIntraNodeCrossingsUsingCircle(node, connMap).numSameLayerCrossings > 0
