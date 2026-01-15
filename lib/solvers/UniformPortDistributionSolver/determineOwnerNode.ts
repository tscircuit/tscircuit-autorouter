import { PortPoint } from "lib/types/high-density-types"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { Bounds, Side } from "./types"
import { classifyPortPointSide } from "./classifyPortPointSide"

interface DetermineOwnerNodeParams {
  portPoint: PortPoint
  currentNodeId: string
  inputNodes: InputNodeWithPortPoints[]
  nodeBounds: Map<string, Bounds>
  sideLengths: Map<string, Record<Side, number>>
}

export const determineOwnerNode = ({
  portPoint,
  currentNodeId,
  inputNodes,
  nodeBounds,
  sideLengths,
}: DetermineOwnerNodeParams): string => {
  const inputNode = inputNodes.find(
    (n) => n.capacityMeshNodeId === currentNodeId,
  )
  const inputPortPoint = inputNode?.portPoints.find(
    (p) => p.portPointId === portPoint.portPointId,
  )
  if (
    !inputPortPoint?.connectionNodeIds ||
    inputPortPoint.connectionNodeIds.length !== 2
  ) {
    return currentNodeId
  }
  const [n1, n2] = inputPortPoint.connectionNodeIds
  const b1 = nodeBounds.get(n1)
  const b2 = nodeBounds.get(n2)
  if (!b1 || !b2) return currentNodeId
  const s1 = classifyPortPointSide({ portPoint, bounds: b1 })
  const s2 = classifyPortPointSide({ portPoint, bounds: b2 })
  if (!s1 || !s2) return currentNodeId
  return sideLengths.get(n1)![s1] <= sideLengths.get(n2)![s2] ? n1 : n2
}
