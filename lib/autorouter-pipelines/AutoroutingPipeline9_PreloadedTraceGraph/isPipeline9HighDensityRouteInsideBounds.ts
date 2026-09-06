import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { matchesPipeline9HdTopologyCoordinate } from "./pipeline9HighDensityCoordinatePrecision"

type PreservedBoundaryAnchors = {
  originalRoute: HighDensityRoute
  node: NodeWithPortPoints
}

const getPreservedBoundaryAnchorIndexes = (
  route: HighDensityRoute,
  bounds: SimpleRouteJson["bounds"],
  { originalRoute, node }: PreservedBoundaryAnchors,
): ReadonlySet<number> => {
  const indexes = new Set<number>()
  for (const direction of [1, -1]) {
    const originalEnd = direction === 1 ? 0 : originalRoute.route.length - 1
    const candidateEnd = direction === 1 ? 0 : route.route.length - 1
    const anchor = originalRoute.route[originalEnd]
    if (
      !anchor ||
      !node.portPoints.some(
        (port) =>
          port.connectionName === originalRoute.connectionName &&
          port.z === anchor.z &&
          port.x >= bounds.minX &&
          port.x <= bounds.maxX &&
          port.y >= bounds.minY &&
          port.y <= bounds.maxY &&
          matchesPipeline9HdTopologyCoordinate(anchor.x, port.x) &&
          matchesPipeline9HdTopologyCoordinate(anchor.y, port.y),
      )
    ) {
      continue
    }
    // Preserve only the original outer anchor and its coincident terminal
    // stack. A generated waypoint at the same rounded boundary is not exempt.
    for (let offset = 0; offset < originalRoute.route.length; offset++) {
      const original = originalRoute.route[originalEnd + direction * offset]
      const candidateIndex = candidateEnd + direction * offset
      const candidate = route.route[candidateIndex]
      if (
        !original ||
        !candidate ||
        original.x !== anchor.x ||
        original.y !== anchor.y ||
        candidate.x !== original.x ||
        candidate.y !== original.y ||
        candidate.z !== original.z
      ) {
        break
      }
      indexes.add(candidateIndex)
    }
  }
  return indexes
}

/** Validates candidate centerlines against the native HD routing domain. */
export const isPipeline9HighDensityRouteInsideBounds = (
  route: HighDensityRoute,
  bounds: SimpleRouteJson["bounds"],
  layerCount: number,
  preservedAnchors?: PreservedBoundaryAnchors,
): boolean => {
  const preservedAnchorIndexes = preservedAnchors
    ? getPreservedBoundaryAnchorIndexes(route, bounds, preservedAnchors)
    : new Set<number>()
  for (let index = 0; index < route.route.length; index++) {
    const point = route.route[index]!
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.z) ||
      point.z < 0 ||
      point.z >= layerCount ||
      (!preservedAnchorIndexes.has(index) &&
        (point.x < bounds.minX ||
          point.x > bounds.maxX ||
          point.y < bounds.minY ||
          point.y > bounds.maxY))
    ) {
      return false
    }
    const next = route.route[index + 1]
    if (
      next &&
      point.z !== next.z &&
      point.toNextSegmentType !== "through_obstacle" &&
      (point.x !== next.x || point.y !== next.y)
    ) {
      return false
    }
  }
  return true
}
