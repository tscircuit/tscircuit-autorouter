import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { IntraNodePhysicalClearanceContext } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Pipeline9FixedPadClearance } from "./createPipeline9FixedPadClearance"
import { createPipeline9FixedPadRectanglePredicate } from "./createPipeline9FixedPadRectanglePredicate"
import { getPipeline9CanonicalPortNetIds } from "./getPipeline9CanonicalPortNetIds"

/** Select the fixed-copper-capable portfolio before any candidate is run. */
export const createPipeline9NodePhysicalClearanceContext = ({
  node,
  connMap,
  fixedPadClearance,
  traceWidth,
  viaDiameter,
  layerCount,
}: {
  node: NodeWithPortPoints
  connMap: ConnectivityMap
  fixedPadClearance: Pipeline9FixedPadClearance
  traceWidth: number
  viaDiameter: number
  layerCount: number
}): IntraNodePhysicalClearanceContext | undefined => {
  if (fixedPadClearance.layerCount !== layerCount) {
    throw new Error("Pipeline9 physical copper and routing board layers differ")
  }
  const canonicalNetIdByConnectionName = getPipeline9CanonicalPortNetIds(
    [node],
    connMap,
  )
  const netIds = new Set(canonicalNetIdByConnectionName.values())
  const overlapsPhysicalNode = createPipeline9FixedPadRectanglePredicate({
    node,
    fixedPadClearance,
    traceWidth,
    viaDiameter,
  })
  const hasForeignCopper = fixedPadClearance.rectangles.some(
    (rectangle): boolean =>
      ![...netIds].every((netId): boolean =>
        rectangle.ownerNetIds.has(netId),
      ) && overlapsPhysicalNode(rectangle),
  )
  if (!hasForeignCopper) return undefined
  return {
    traceClearanceIndex: fixedPadClearance.traceClearanceIndex,
    viaClearanceIndex: fixedPadClearance.viaClearanceIndex,
    // Match the existing Pipeline9 uniform-port and post-route copper rules,
    // independently of its search obstacle margin or fixed-pad clearances.
    traceToTraceClearance: 0.1,
    viaToTraceClearance: 0.1,
    canonicalNetIdByConnectionName,
    solveToPhysicalTransform: { center: { ...node.center }, scale: 1 },
  }
}
