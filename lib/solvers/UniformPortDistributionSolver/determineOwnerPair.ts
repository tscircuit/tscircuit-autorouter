import type { CapacityMeshNodeId } from "lib/types"
import type {
  InputPortPoint,
  PortPointId,
} from "../PortPointPathingSolver/PortPointPathingSolver"
import { normalizeOwnerPair } from "./getOwnerPairKey"
import { OwnerPair } from "./types"

interface DetermineOwnerPairParams {
  portPointId?: PortPointId
  currentNodeId: CapacityMeshNodeId
  connectionNodeIdsByPortPointId: Map<
    PortPointId,
    InputPortPoint["connectionNodeIds"]
  >
}

/**
 * Resolves the canonical two-node ownership for a port point so shared-edge
 * redistribution can always operate on a stable family identity.
 */
export const determineOwnerPair = ({
  portPointId,
  currentNodeId,
  connectionNodeIdsByPortPointId,
}: DetermineOwnerPairParams): OwnerPair => {
  const connectionNodeIds = portPointId
    ? connectionNodeIdsByPortPointId.get(portPointId)
    : undefined

  if (!connectionNodeIds || connectionNodeIds.length !== 2) {
    return [currentNodeId, currentNodeId]
  }

  const [nodeA, nodeB] = connectionNodeIds
  if (!nodeA || !nodeB) return [currentNodeId, currentNodeId]

  return normalizeOwnerPair(nodeA, nodeB)
}
