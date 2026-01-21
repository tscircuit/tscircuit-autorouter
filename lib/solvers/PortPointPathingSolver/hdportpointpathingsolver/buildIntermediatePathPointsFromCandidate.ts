import type { Candidate } from "@tscircuit/hypergraph"
import type { HgPort, HgRegion } from "./buildHyperGraphFromInputNodes"
import type { ConnectionPathResult } from "../PortPointPathingSolver"

/**
 * Build intermediate path points from the last candidate.
 */
export function buildIntermediatePathPointsFromCandidate({
  lastCandidate,
  connectionResult,
}: {
  lastCandidate: Candidate<HgRegion, HgPort> | null
  connectionResult: ConnectionPathResult | null
}): Array<{ x: number; y: number }> {
  if (!lastCandidate) return []

  const points: Array<{ x: number; y: number }> = []
  let cursor: Candidate<HgRegion, HgPort> | undefined = lastCandidate
  while (cursor) {
    points.unshift({ x: cursor.port.d.x, y: cursor.port.d.y })
    cursor = cursor.parent
  }

  const startPoint = connectionResult?.connection.pointsToConnect[0]
  if (startPoint) {
    points.unshift({ x: startPoint.x, y: startPoint.y })
  }

  return points
}
