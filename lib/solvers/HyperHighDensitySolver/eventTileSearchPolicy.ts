import type { NodeWithPortPoints } from "lib/types/high-density-types"

export type EventTileSearchPolicy = {
  eligible: boolean
  reason: "eligible" | "grid" | "interactions" | "budget"
  states: number
  preprocessingReserve: number
}

/**
 * Conservative trial policy, not a theorem about which PCB nodes are easy.
 * A portfolio quantum is 100 A13 steps of 1000 kernel work units. Reserve at
 * most half of it for a full signature scan, worst-case compact initialization
 * and coordinates, leaving room to demonstrate route progress in that quantum.
 * The separate terminal cap bounds interaction growth seen in dense negotiated
 * fields. Outside this policy the original A13 candidate is constructed.
 */
export function getEventTileSearchPolicy(params: {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  traceThickness: number
  traceMargin: number
  maxSearchIterations: number
}): EventTileSearchPolicy {
  const node = params.nodeWithPortPoints
  const inset = params.traceThickness / 2 + params.traceMargin
  const cols = Math.ceil((node.width - 2 * inset) / params.cellSizeMm) + 1
  const rows = Math.ceil((node.height - 2 * inset) / params.cellSizeMm) + 1
  const layers = node.availableZ?.length ?? new Set(node.portPoints.map((point) => point.z)).size
  const states = cols * rows * layers
  const preprocessingReserve = 2 * states + cols + rows + 1024
  const reason = !Number.isSafeInteger(states) || cols < 2 || rows < 2 ||
    layers < 1 || preprocessingReserve > 50_000
    ? "grid"
    : node.portPoints.length > 32 ? "interactions"
    : !Number.isSafeInteger(params.maxSearchIterations) ||
      params.maxSearchIterations < preprocessingReserve ? "budget" : "eligible"
  return { eligible: reason === "eligible", reason, states, preprocessingReserve }
}
