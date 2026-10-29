import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { normalizeOwnerPair } from "./getOwnerPairKey"
import { OwnerPair } from "./types"

interface DetermineOwnerPairParams {
  portPointId?: string
  currentNodeId: string
  inputNodes: InputNodeWithPortPoints[]
  connectionNodeIdsByPortPointId?: ReadonlyMap<string, [string, string]>
}

/** Index the first matching port in each node, preserving lookup precedence. */
export const indexPortPointOwnerNodes = (
  inputNodes: InputNodeWithPortPoints[],
): Map<string, [string, string]> => {
  const owners = new Map<string, [string, string]>()
  for (const node of inputNodes) {
    const seenInNode = new Set<string>()
    for (const point of node.portPoints) {
      const id = point.portPointId
      if (!id || seenInNode.has(id)) continue
      seenInNode.add(id)
      if (!owners.has(id) && point.connectionNodeIds) {
        owners.set(id, point.connectionNodeIds)
      }
    }
  }
  return owners
}

/**
 * Resolves the canonical two-node ownership for a port point so shared-edge
 * redistribution can always operate on a stable family identity.
 */
export const determineOwnerPair = ({
  portPointId,
  currentNodeId,
  inputNodes,
  connectionNodeIdsByPortPointId,
}: DetermineOwnerPairParams): OwnerPair => {
  let connectionNodeIds = portPointId
    ? connectionNodeIdsByPortPointId?.get(portPointId)
    : undefined

  if (portPointId && !connectionNodeIdsByPortPointId) {
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
