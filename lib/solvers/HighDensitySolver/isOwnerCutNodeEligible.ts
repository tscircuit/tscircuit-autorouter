import type { NodeWithPortPoints } from "lib/types/high-density-types"

/** Exact eligibility for the bounded two-physical-layer owned kernel. */
export function isOwnerCutNodeEligible(params: {
  nodeWithPortPoints: NodeWithPortPoints
  layerCount?: number
  viaDiameter?: number
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  allowBlindAndBuriedVias?: boolean
  priorityCoordinateScale?: number
}): boolean {
  const node = params.nodeWithPortPoints
  const rows = Math.floor(node.height / 0.1)
  const cols = Math.floor(node.width / 0.1)
  const viaDiameter = params.viaDiameter ?? 0.3
  const owners = new Set(node.portPoints.map((point) => point.connectionName))
  return params.layerCount === 2 && !params.allowBlindAndBuriedVias &&
    (params.priorityCoordinateScale ?? 1) === 1 &&
    node.availableZ?.length === 2 && node.availableZ[0] === 0 &&
    node.availableZ[1] === 1 && rows >= 2 && cols >= 2 &&
    Number.isFinite(viaDiameter) && viaDiameter > 0 && viaDiameter <= 1 &&
    node.portPoints.every((point) => point.z === 0 || point.z === 1) &&
    rows * cols * 2 <= 2048 && node.portPoints.length <= 32 && owners.size >= 1 && owners.size <= 8 &&
    Number.isFinite(params.viaHoleDiameter) && params.viaHoleDiameter! > 0 &&
    Number.isFinite(params.minViaHoleEdgeToViaHoleEdgeClearance) &&
    params.minViaHoleEdgeToViaHoleEdgeClearance! >= 0
}
