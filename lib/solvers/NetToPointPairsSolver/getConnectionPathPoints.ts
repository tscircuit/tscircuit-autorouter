import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"

/** Resolve a declared path without changing its point order. */
export function getConnectionPathPoints(
  connection: SimpleRouteConnection,
): ConnectionPoint[] {
  const { name, path, pointsToConnect } = connection
  if (!path) {
    if (pointsToConnect.length > 2)
      throw new Error(
        `Connection "${name}" needs a path for its ${pointsToConnect.length} points`,
      )
    return pointsToConnect
  }
  if (path.length < 2 || new Set(path).size !== path.length)
    throw new Error(
      `Connection "${name}" needs at least two distinct point IDs in its path`,
    )
  return path.map((pointId) => {
    const matches = pointsToConnect.filter((point) => point.pointId === pointId)
    if (matches.length !== 1)
      throw new Error(
        `Connection "${name}" path point "${pointId}" must identify exactly one point in pointsToConnect`,
      )
    return matches[0]!
  })
}
