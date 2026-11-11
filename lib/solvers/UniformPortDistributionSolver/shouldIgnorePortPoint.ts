import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import { PortPoint } from "lib/types/high-density-types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { OwnerPair } from "./types"

interface ShouldIgnorePortPointParams {
  portPoint: PortPoint
  ownerNodeIds: OwnerPair
  inputNodeById: ReadonlyMap<CapacityMeshNodeId, InputNodeWithPortPoints>
}

/**
 * Excludes port points tied to target-containing nodes so redistribution
 * does not alter constrained entry/exit behavior around route endpoints.
 */
export const shouldIgnorePortPoint = ({
  portPoint,
  ownerNodeIds,
  inputNodeById,
}: ShouldIgnorePortPointParams): boolean => {
  for (const ownerNodeId of ownerNodeIds) {
    const inputNode = inputNodeById.get(ownerNodeId)
    if (inputNode?._containsTarget) return true
    const inputPortPoint = inputNode?.portPoints.find(
      (p) => p.portPointId === portPoint.portPointId,
    )
    if (
      inputPortPoint?.connectionNodeIds?.some(
        (id) => inputNodeById.get(id)?._containsTarget,
      )
    ) {
      return true
    }
  }
  return false
}
