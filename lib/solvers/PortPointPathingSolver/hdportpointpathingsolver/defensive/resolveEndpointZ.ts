import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"
import type {
  InputNodeWithPortPoints,
  PortPointCandidate,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { getAllowedZForEndpoint } from "./getAllowedZForEndpoint"

/** Resolves the endpoint z layer by preferring the candidate z and falling back to the nearest allowed endpoint layer on mismatch. */
export function resolveEndpointZ({
  connectionPoint,
  candidate,
  node,
  endpointName,
  connection,
}: {
  connectionPoint: ConnectionPoint
  candidate: PortPointCandidate
  node: InputNodeWithPortPoints
  endpointName: "start" | "end"
  connection: SimpleRouteConnection
}): number {
  const allowedZ = getAllowedZForEndpoint({
    connectionPoint,
    node,
  })

  if (allowedZ.length === 0) {
    return candidate.z
  }

  if (allowedZ.includes(candidate.z)) {
    return candidate.z
  }

  // Defensive fallback: when path z and endpoint layer disagree, choose a valid
  // layer from endpoint declaration instead of propagating an impossible state.
  const fallbackZ = allowedZ.reduce((best, current) =>
    Math.abs(current - candidate.z) < Math.abs(best - candidate.z)
      ? current
      : best,
  )
  console.assert(
    false,
    `[addConnectionEndpointsToNodeAssignments] ${endpointName} endpoint for "${connection.name}" is on z=${candidate.z} but endpoint allows z in [${allowedZ.join(", ")}]; using fallback z=${fallbackZ}`,
  )
  console.error(
    `[addConnectionEndpointsToNodeAssignments] ${endpointName} endpoint for "${connection.name}" layer mismatch; using fallback z=${fallbackZ}`,
  )
  return fallbackZ
}
