import type { CapacityMeshNodeId } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import type { PortPointId } from "../PortPointPathingSolver/PortPointPathingSolver"
import type { OwnerPair } from "./types"

interface ShouldIgnorePortPointParams {
  portPoint: PortPoint
  ownerNodeIds: OwnerPair
  targetNodeIds: ReadonlySet<CapacityMeshNodeId>
  portPointIdsConnectedToTarget: ReadonlySet<PortPointId>
}

/**
 * Excludes port points tied to target-containing nodes so redistribution
 * does not alter constrained entry/exit behavior around route endpoints.
 */
export const shouldIgnorePortPoint = ({
  portPoint,
  ownerNodeIds,
  targetNodeIds,
  portPointIdsConnectedToTarget,
}: ShouldIgnorePortPointParams): boolean => {
  if (ownerNodeIds.some((nodeId) => targetNodeIds.has(nodeId))) return true
  return (
    portPoint.portPointId !== undefined &&
    portPointIdsConnectedToTarget.has(portPoint.portPointId)
  )
}
