import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"
import type {
  InputNodeWithPortPoints,
  PortPointCandidate,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { isAtNodeCenter } from "./isAtNodeCenter"
import { resolveEndpointZ } from "./resolveEndpointZ"

export function toCenteredEndpoint({
  connectionPoint,
  candidate,
  node,
  endpointName,
  connection,
}: {
  connectionPoint: ConnectionPoint
  candidate: PortPointCandidate
  node?: InputNodeWithPortPoints
  endpointName: "start" | "end"
  connection: SimpleRouteConnection
}): { x: number; y: number; z: number } {
  if (!node) {
    // Defensive fallback: without node geometry we cannot center-correct or parse
    // "bottom" relative to availableZ, so preserve endpoint coordinates and candidate z.
    console.error(
      `[addConnectionEndpointsToNodeAssignments] ${endpointName} endpoint for "${connection.name}" missing node; using raw endpoint/candidate values`,
    )
    return {
      x: connectionPoint.x,
      y: connectionPoint.y,
      z: candidate.z,
    }
  }

  const resolvedZ = resolveEndpointZ({
    connectionPoint,
    candidate,
    node,
    endpointName,
    connection,
  })

  const centered = isAtNodeCenter({ point: connectionPoint, node })
  console.assert(
    centered,
    `[addConnectionEndpointsToNodeAssignments] ${endpointName} endpoint for "${connection.name}" is not at node center; replacing with node center`,
  )
  if (!centered) {
    return {
      x: node.center.x,
      y: node.center.y,
      z: resolvedZ,
    }
  }
  return {
    x: connectionPoint.x,
    y: connectionPoint.y,
    z: resolvedZ,
  }
}
