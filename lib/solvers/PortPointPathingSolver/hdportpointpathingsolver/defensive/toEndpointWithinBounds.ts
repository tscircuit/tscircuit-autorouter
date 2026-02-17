import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"
import type {
  InputNodeWithPortPoints,
  PortPointCandidate,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { clampPointToNodeBounds } from "./clampPointToNodeBounds"
import { isPointInsideOrOnNodeBounds } from "./isPointInsideOrOnNodeBounds"
import { resolveEndpointZ } from "./resolveEndpointZ"

/** Normalizes an endpoint by resolving its z layer and ensuring its x/y lies within node bounds, clamping when needed. */
export function toEndpointWithinBounds({
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
    // Defensive fallback: without node geometry we cannot bounds-check or parse
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

  const insideOrOnBounds = isPointInsideOrOnNodeBounds({
    point: connectionPoint,
    node,
  })
  if (!insideOrOnBounds) {
    const clampedPoint = clampPointToNodeBounds({
      point: connectionPoint,
      node,
    })
    console.assert(
      insideOrOnBounds,
      `[addConnectionEndpointsToNodeAssignments] ${endpointName} endpoint for "${connection.name}" connectionPoint outside obstacle/node bounds; original=(${connectionPoint.x}, ${connectionPoint.y}) clamped=(${clampedPoint.x}, ${clampedPoint.y})`,
    )
    return {
      x: clampedPoint.x,
      y: clampedPoint.y,
      z: resolvedZ,
    }
  }

  return {
    x: connectionPoint.x,
    y: connectionPoint.y,
    z: resolvedZ,
  }
}
