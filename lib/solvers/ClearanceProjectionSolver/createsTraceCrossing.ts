import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Point = { x: number; y: number; z: number }
type Segment = {
  routeIndex: number
  pointIndex: number
  a: Point
  b: Point
  root: string
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const orientation = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const crosses = (a: Point, b: Point, c: Point, d: Point): boolean =>
  orientation(a, b, c) * orientation(a, b, d) < -1e-18 &&
  orientation(c, d, a) * orientation(c, d, b) < -1e-18

/** Projection preserves point order, so each candidate segment has an exact predecessor. */
export const createsTraceCrossing = (
  originalRoutes: HighDensityRoute[],
  routes: HighDensityRoute[],
  connMap?: ConnectivityMap,
): boolean => {
  const segments: Segment[] = []
  for (const [routeIndex, route] of routes.entries()) {
    const name = route.rootConnectionName ?? route.connectionName
    const root = connMap?.getNetConnectedToId(name) ?? name
    for (
      let pointIndex = 0;
      pointIndex < route.route.length - 1;
      pointIndex++
    ) {
      const a = route.route[pointIndex]!
      const b = route.route[pointIndex + 1]!
      if (a.z !== b.z || a.toNextSegmentType === "through_obstacle") continue
      segments.push({
        routeIndex,
        pointIndex,
        a,
        b,
        root,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      })
    }
  }
  segments.sort((a, b) => a.minX - b.minX)
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!
      if (b.minX > a.maxX) break
      if (
        a.root === b.root ||
        a.a.z !== b.a.z ||
        a.minY > b.maxY ||
        b.minY > a.maxY ||
        !crosses(a.a, a.b, b.a, b.b)
      ) {
        continue
      }
      const originalA = originalRoutes[a.routeIndex]!.route
      const originalB = originalRoutes[b.routeIndex]!.route
      if (
        !crosses(
          originalA[a.pointIndex]!,
          originalA[a.pointIndex + 1]!,
          originalB[b.pointIndex]!,
          originalB[b.pointIndex + 1]!,
        )
      ) {
        return true
      }
    }
  }
  return false
}
