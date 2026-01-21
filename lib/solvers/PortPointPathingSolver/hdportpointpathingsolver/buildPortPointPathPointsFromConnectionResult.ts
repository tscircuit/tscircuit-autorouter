import type { ConnectionPathResult } from "../PortPointPathingSolver"

/**
 * Build path points from a connection result.
 */
export function buildPortPointPathPointsFromConnectionResult({
  connectionResult,
}: {
  connectionResult: ConnectionPathResult
}): Array<{ x: number; y: number }> {
  if (!connectionResult.path || connectionResult.path.length === 0) {
    return []
  }
  return connectionResult.path.map((candidate) => ({
    x: candidate.point.x,
    y: candidate.point.y,
  }))
}
