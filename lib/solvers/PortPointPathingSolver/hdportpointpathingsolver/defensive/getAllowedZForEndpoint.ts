import type { ConnectionPoint } from "lib/types"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { parseLayerNameToZ } from "./parseLayerNameToZ"

/** Produces the list of valid z indices declared by a connection endpoint, logging when layers are missing or unparseable. */
export function getAllowedZForEndpoint({
  connectionPoint,
  node,
}: {
  connectionPoint: ConnectionPoint
  node: InputNodeWithPortPoints
}): number[] {
  // Negative-space invariant: every endpoint must declare at least one parseable layer.
  const declaredLayers = getConnectionPointLayers(connectionPoint)
  if (declaredLayers.length === 0) {
    console.error(
      `[addConnectionEndpointsToNodeAssignments] endpoint has no declared layers; falling back to candidate z`,
    )
    return []
  }

  const allowedZ = declaredLayers
    .map((layerName) => parseLayerNameToZ({ layerName, node }))
    .filter((z): z is number => z !== undefined)

  if (allowedZ.length === 0) {
    console.error(
      `[addConnectionEndpointsToNodeAssignments] endpoint has unparseable layer names: ${declaredLayers.join(", ")}; falling back to candidate z`,
    )
  }
  return allowedZ
}
