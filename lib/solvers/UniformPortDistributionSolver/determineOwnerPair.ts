import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { normalizeOwnerPair } from "./getOwnerPairKey"
import { OwnerPair } from "./types"

interface DetermineOwnerPairParams {
  portPointId?: string
  currentNodeId: string
  inputNodes: InputNodeWithPortPoints[]
}

/**
 * Resolves the canonical two-node ownership for a port point so shared-edge
 * redistribution can always operate on a stable family identity.
 */
export const determineOwnerPair = ({
  portPointId,
  currentNodeId,
  inputNodes,
}: DetermineOwnerPairParams): OwnerPair => {
  let connectionNodeIds: [string, string] | undefined

  if (portPointId) {
    for (const node of inputNodes) {
      const point = node.portPoints.find((p) => p.portPointId === portPointId)
      if (point?.connectionNodeIds) {
        connectionNodeIds = point.connectionNodeIds
        break
      }
    }
  }

  if (!connectionNodeIds || connectionNodeIds.length !== 2) {
    return [currentNodeId, currentNodeId]
  }

  const [nodeA, nodeB] = connectionNodeIds
  if (!nodeA || !nodeB) return [currentNodeId, currentNodeId]

  return normalizeOwnerPair(nodeA, nodeB)
}
