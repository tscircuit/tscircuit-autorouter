import { PortPoint } from "lib/types/high-density-types"
import type { CapacityMeshNodeId } from "lib/types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { OwnerPair } from "./types"

interface ShouldIgnorePortPointParams {
  portPoint: PortPoint
  ownerNodeIds: OwnerPair
  inputNodesById: ReadonlyMap<CapacityMeshNodeId, InputNodeWithPortPoints>
}

/**
 * Excludes port points tied to target-containing nodes so redistribution
 * does not alter constrained entry/exit behavior around route endpoints.
 */
export const shouldIgnorePortPoint = ({
  portPoint,
  ownerNodeIds,
  inputNodesById,
}: ShouldIgnorePortPointParams): boolean => {
  for (const ownerNodeId of ownerNodeIds) {
    const inputNode = inputNodesById.get(ownerNodeId)
    if (inputNode?._containsTarget) return true
    const inputPortPoint = inputNode?.portPoints.find(
      (p) => p.portPointId === portPoint.portPointId,
    )
    if (
      inputPortPoint?.connectionNodeIds?.some(
        (id) =>
          inputNodesById.get(id)?._containsTarget,
      )
    ) {
      return true
    }
  }
  return false
}
