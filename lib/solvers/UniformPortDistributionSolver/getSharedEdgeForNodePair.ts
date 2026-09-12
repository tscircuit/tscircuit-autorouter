import { Bounds, SharedEdge } from "./types"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"
import { decodeSharedEdge, encodeName, encodeBounds } from "../../bindings/uniform-port-distribution/UniformPortDistributionCodec"
import { getUniformSharedEdge } from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"

/**
 * Finds the single geometric boundary segment shared by two rectangular
 * capacity nodes and annotates orientation, center, and side ownership.
 */
export const getSharedEdgeForNodePair = ({
  nodeAId,
  nodeBId,
  nodeBounds,
}: {
  nodeAId: string
  nodeBId: string
  nodeBounds: Map<string, Bounds>
}): SharedEdge | null => {
  initializeAutorouterBindings()
  const edge = getUniformSharedEdge({
    nodeAId: encodeName(nodeAId),
    nodeBId: encodeName(nodeBId),
    nodeBounds: [...nodeBounds].map(([key, bounds]) => [encodeName(key), encodeBounds(bounds)]),
  })
  return edge == null ? null : decodeSharedEdge(edge)
}
