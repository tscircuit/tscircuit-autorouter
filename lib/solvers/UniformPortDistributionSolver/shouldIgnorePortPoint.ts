import { PortPoint } from "lib/types/high-density-types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"

interface ShouldIgnorePortPointParams {
  portPoint: PortPoint
  nodeId: string
  inputNodes: InputNodeWithPortPoints[]
}

export const shouldIgnorePortPoint = ({
  portPoint,
  nodeId,
  inputNodes,
}: ShouldIgnorePortPointParams): boolean => {
  const inputNode = inputNodes.find((n) => n.capacityMeshNodeId === nodeId)
  if (inputNode?._containsTarget) return true
  const ipp = inputNode?.portPoints.find(
    (p) => p.portPointId === portPoint.portPointId,
  )
  return (
    ipp?.connectionNodeIds?.some(
      (id) =>
        inputNodes.find((n) => n.capacityMeshNodeId === id)?._containsTarget,
    ) ?? false
  )
}
