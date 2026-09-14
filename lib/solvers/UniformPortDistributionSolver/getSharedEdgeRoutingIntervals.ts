import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type {
  BoundaryRoutingGeometry,
  RoutingInterval,
  SharedEdge,
} from "./types"

/** Free trace-center intervals on an edge after preprocessed copper clearance. */
export function getSharedEdgeRoutingIntervals({
  sharedEdge,
  z,
  routingGeometry,
}: {
  sharedEdge: SharedEdge
  z: number
  routingGeometry: BoundaryRoutingGeometry
}): RoutingInterval[] {
  if (
    !Number.isFinite(routingGeometry.traceWidth) ||
    routingGeometry.traceWidth <= 0 ||
    !Number.isFinite(routingGeometry.traceClearance) ||
    routingGeometry.traceClearance < 0
  ) {
    throw new Error(
      "Boundary routing requires a positive trace width and nonnegative clearance",
    )
  }
  const horizontal = sharedEdge.orientation === "horizontal"
  const edgeMin = horizontal ? sharedEdge.x1 : sharedEdge.y1
  const edgeMax = horizontal ? sharedEdge.x2 : sharedEdge.y2
  const normalCoordinate = horizontal ? sharedEdge.y1 : sharedEdge.x1
  const clearance =
    routingGeometry.traceWidth / 2 + routingGeometry.traceClearance
  const blocked: RoutingInterval[] = []
  for (const obstacle of routingGeometry.obstacles) {
    const layers =
      obstacle.zLayers ??
      obstacle.layers.map((layer) =>
        mapLayerNameToZ(layer, routingGeometry.layerCount),
      )
    if (!layers.includes(z)) continue
    if (
      obstacle.ccwRotationDegrees !== undefined &&
      obstacle.ccwRotationDegrees !== 0
    ) {
      throw new Error(
        "Shared-edge clearance requires preprocessed axis-aligned obstacles",
      )
    }
    const tangentCenter = horizontal ? obstacle.center.x : obstacle.center.y
    const normalCenter = horizontal ? obstacle.center.y : obstacle.center.x
    const tangentHalfSize = (horizontal ? obstacle.width : obstacle.height) / 2
    const normalHalfSize = (horizontal ? obstacle.height : obstacle.width) / 2
    let tangentRadius: number
    if (obstacle.shape === "circle") {
      if (obstacle.width !== obstacle.height)
        throw new Error("Circular copper must have equal width and height")
      const radius = tangentHalfSize + clearance
      const normalDistance = Math.abs(normalCoordinate - normalCenter)
      if (normalDistance >= radius) continue
      tangentRadius = Math.sqrt(
        radius * radius - normalDistance * normalDistance,
      )
    } else {
      const normalGap = Math.max(
        0,
        Math.abs(normalCoordinate - normalCenter) - normalHalfSize,
      )
      if (normalGap >= clearance) continue
      tangentRadius =
        tangentHalfSize +
        Math.sqrt(clearance * clearance - normalGap * normalGap)
    }
    const min = Math.max(edgeMin, tangentCenter - tangentRadius)
    const max = Math.min(edgeMax, tangentCenter + tangentRadius)
    if (max > min) blocked.push({ min, max })
  }
  blocked.sort((a, b) => a.min - b.min || a.max - b.max)
  const intervals: RoutingInterval[] = []
  let cursor = edgeMin
  for (const interval of blocked) {
    if (interval.min > cursor)
      intervals.push({ min: cursor, max: interval.min })
    cursor = Math.max(cursor, interval.max)
  }
  if (cursor < edgeMax) intervals.push({ min: cursor, max: edgeMax })
  return intervals
}
