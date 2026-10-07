import type { PortPoint } from "lib/types/high-density-types"
import type { CapacityMeshNodeId } from "lib/types"
import type { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import type { OwnerPair } from "./types"

export type InputNodeById = ReadonlyMap<
  CapacityMeshNodeId,
  InputNodeWithPortPoints
>

interface ShouldIgnorePortPointParams {
  portPoint: PortPoint
  ownerNodeIds: OwnerPair
  inputNodeById: InputNodeById
}

/** Index the first matching node, preserving legacy Array.find precedence. */
export const indexInputNodesById = (
  inputNodes: InputNodeWithPortPoints[],
): InputNodeById => {
  const inputNodeById = new Map<CapacityMeshNodeId, InputNodeWithPortPoints>()
  for (const inputNode of inputNodes) {
    if (!inputNodeById.has(inputNode.capacityMeshNodeId)) {
      inputNodeById.set(inputNode.capacityMeshNodeId, inputNode)
    }
  }
  return inputNodeById
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
      (point) => point.portPointId === portPoint.portPointId,
    )
    if (
      inputPortPoint?.connectionNodeIds.some(
        (connectionNodeId) =>
          inputNodeById.get(connectionNodeId)?._containsTarget,
      )
    ) {
      return true
    }
  }
  return false
}
