import type { RegionHg, RegionPortHg } from "./types"

export type TopologyPoint = { x: number; y: number; z: number }
export type RectangularTopologyRegion = {
  center: { x: number; y: number }
  width: number
  height: number
}

function perimeterT(
  point: TopologyPoint,
  region: RectangularTopologyRegion,
): number {
  const minX = region.center.x - region.width / 2
  const maxX = region.center.x + region.width / 2
  const minY = region.center.y - region.height / 2
  const maxY = region.center.y + region.height / 2
  const width = maxX - minX
  const height = maxY - minY
  const epsilon = 1e-6

  if (Math.abs(point.y - maxY) < epsilon) return point.x - minX
  if (Math.abs(point.x - maxX) < epsilon) {
    return width + (maxY - point.y)
  }
  if (Math.abs(point.y - minY) < epsilon) {
    return width + height + (maxX - point.x)
  }
  if (Math.abs(point.x - minX) < epsilon) {
    return 2 * width + height + (point.y - minY)
  }

  const distanceToTop = Math.abs(point.y - maxY)
  const distanceToRight = Math.abs(point.x - maxX)
  const distanceToBottom = Math.abs(point.y - minY)
  const distanceToLeft = Math.abs(point.x - minX)
  const closestDistance = Math.min(
    distanceToTop,
    distanceToRight,
    distanceToBottom,
    distanceToLeft,
  )

  if (closestDistance === distanceToTop) {
    return Math.max(0, Math.min(width, point.x - minX))
  }
  if (closestDistance === distanceToRight) {
    return width + Math.max(0, Math.min(height, maxY - point.y))
  }
  if (closestDistance === distanceToBottom) {
    return width + height + Math.max(0, Math.min(width, maxX - point.x))
  }
  return 2 * width + height + Math.max(0, Math.min(height, point.y - minY))
}

function chordsCross(
  chord1: [number, number],
  chord2: [number, number],
): boolean {
  const [a, b] = chord1[0] < chord1[1] ? chord1 : [chord1[1], chord1[0]]
  const [c, d] = chord2[0] < chord2[1] ? chord2 : [chord2[1], chord2[0]]
  const epsilon = 1e-6

  if (
    Math.abs(a - c) < epsilon ||
    Math.abs(a - d) < epsilon ||
    Math.abs(b - c) < epsilon ||
    Math.abs(b - d) < epsilon
  ) {
    return false
  }

  return (a < c && c < b && b < d) || (c < a && a < d && d < b)
}

/**
 * Returns whether two routes are topologically forced to cross inside a
 * rectangular hypergraph region. This intentionally uses boundary-port
 * interleaving rather than Cartesian segment intersection: the intra-region
 * solver may bend a trace, but it cannot untangle interleaved boundary ports.
 */
export function doRegionPortPairsCross(
  region: RegionHg,
  port1: RegionPortHg,
  port2: RegionPortHg,
  otherPort1: RegionPortHg,
  otherPort2: RegionPortHg,
): boolean {
  return doPointPairsCrossInRegion(
    region.d,
    port1.d,
    port2.d,
    otherPort1.d,
    otherPort2.d,
  )
}

export function doPointPairsCrossInRegion(
  region: RectangularTopologyRegion,
  point1: TopologyPoint,
  point2: TopologyPoint,
  otherPoint1: TopologyPoint,
  otherPoint2: TopologyPoint,
): boolean {
  const pairChangesLayer = point1.z !== point2.z
  const otherPairChangesLayer = otherPoint1.z !== otherPoint2.z

  if (pairChangesLayer !== otherPairChangesLayer) return false
  if (!pairChangesLayer && point1.z !== otherPoint1.z) return false

  return chordsCross(
    [perimeterT(point1, region), perimeterT(point2, region)],
    [perimeterT(otherPoint1, region), perimeterT(otherPoint2, region)],
  )
}
