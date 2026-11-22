import {
  BgaEscapeRoutingSolver,
  BgaSurfaceRoutingSolver,
} from "@tscircuit/high-density-phase-solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  getBgaEscapeRoutingInput,
  type BgaEscapeBoard,
} from "./getBgaEscapeRoutingInput"

export function createBgaRoutingSolver(
  board: BgaEscapeBoard,
  regionalPlan?: NodeWithPortPoints[],
): BgaEscapeRoutingSolver | BgaSurfaceRoutingSolver | undefined {
  const input = getBgaEscapeRoutingInput(board)
  if (!input) return
  const bottom = board.inputSrj.layerCount - 1
  const hasInnerSignalLayer = input.signalLayers.some(
    (z) => z > 0 && z < bottom,
  )
  if (regionalPlan) {
    // Keep a usable regional plan. A through-via crossing a plane does not
    // establish that the plane can carry the planned horizontal traces.
    const usesInnerLayer = regionalPlan.some((node) =>
      node.portPoints.some((point) => point.z > 0 && point.z < bottom),
    )
    if (hasInnerSignalLayer || !usesInnerLayer) return
  }
  return hasInnerSignalLayer
    ? new BgaEscapeRoutingSolver(input)
    : new BgaSurfaceRoutingSolver(input)
}
