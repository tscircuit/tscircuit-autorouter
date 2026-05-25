import { NodeWithPortPoints } from "lib/types/high-density-types"
import { getPortPointsFromNodeWithPortPoints } from "./getPortPointsFromNodeWithPortPoints"

export const getMinDistBetweenEnteringPoints = (node: NodeWithPortPoints) => {
  let minDist = Infinity
  const points = getPortPointsFromNodeWithPortPoints(node)

  // Compare each point with every other point
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const p1 = points[i]
      const p2 = points[j]

      // Skip points on different layers
      if (p1.z !== p2.z) {
        continue
      }

      // Skip points from the same root net (they can share junction points)
      if (
        p1.rootConnectionName &&
        p1.rootConnectionName === p2.rootConnectionName
      ) {
        continue
      }

      // Calculate Euclidean distance between points
      const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)

      minDist = Math.min(minDist, dist)
    }
  }

  return minDist === Infinity ? 0 : minDist
}
