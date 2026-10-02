import type { CapacityMeshNodeId } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
  PortPointId,
} from "../PortPointPathingSolver/PortPointPathingSolver"
import type { OwnerPair } from "./types"

interface ShouldIgnorePortPointParams {
  portPoint: PortPoint
  ownerNodeIds: OwnerPair
  inputNodeById: ReadonlyMap<CapacityMeshNodeId, InputNodeWithPortPoints>
  inputPortPointByNodeId: ReadonlyMap<
    CapacityMeshNodeId,
    ReadonlyMap<PortPointId, InputPortPoint>
  >
}

/**
 * Excludes port points tied to target-containing nodes so redistribution
 * does not alter constrained entry/exit behavior around route endpoints.
 */
export const shouldIgnorePortPoint = ({
  portPoint,
  ownerNodeIds,
  inputNodeById,
  inputPortPointByNodeId,
}: ShouldIgnorePortPointParams): boolean => {
  for (const ownerNodeId of ownerNodeIds) {
    const inputNode = inputNodeById.get(ownerNodeId)
    if (inputNode?._containsTarget) return true
    const inputPortPoint = portPoint.portPointId
      ? inputPortPointByNodeId.get(ownerNodeId)?.get(portPoint.portPointId)
      : undefined
    if (
      inputPortPoint?.connectionNodeIds.some(
        (nodeId) => inputNodeById.get(nodeId)?._containsTarget,
      )
    ) {
      return true
    }
  }
  return false
}
