import { PortPoint } from "lib/types/high-density-types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { OwnerPair } from "./types"

interface ShouldIgnorePortPointParams {
  portPoint: PortPoint
  ownerNodeIds: OwnerPair
  inputNodes: InputNodeWithPortPoints[]
}

/**
 * Excludes port points tied to target-containing nodes so redistribution
 * does not alter constrained entry/exit behavior around route endpoints.
 */
export const shouldIgnorePortPoint = ({
  portPoint,
  ownerNodeIds,
  inputNodes,
}: ShouldIgnorePortPointParams): boolean => {
  for (const ownerNodeId of ownerNodeIds) {
    const inputNode = inputNodes.find(
      (n) => n.capacityMeshNodeId === ownerNodeId,
    )
    if (inputNode?._containsTarget) return true
    const inputPortPoint = inputNode?.portPoints.find(
      (p) => p.portPointId === portPoint.portPointId,
    )
    if (
      inputPortPoint?.connectionNodeIds?.some(
        (id) =>
          inputNodes.find((n) => n.capacityMeshNodeId === id)?._containsTarget,
      )
    ) {
      return true
    }
  }
  return false
}
