import { expect, test } from "bun:test"
import { doSegmentsIntersect } from "@tscircuit/math-utils"
import {
  HighDensityRouteSpatialIndex,
  type HighDensityRoute,
} from "lib/data-structures/HighDensityRouteSpatialIndex"

type Point = { x: number; y: number; z: number }
type Conflict = { conflictingRoute: HighDensityRoute; distance: number }
type IndexState = {
  CELL_SIZE: number
  maximumCopperRadius: number
  queryNumber: number
  segmentBuckets: Map<
    string,
    {
      segmentId: string
      segment: [Point, Point]
      parentRoute: HighDensityRoute
    }[]
  >
  viaBuckets: Map<
    string,
    { viaId: string; x: number; y: number; parentRoute: HighDensityRoute }[]
  >
}

const pointDistanceSq = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number => {
  const dx = start.x - end.x
  const dy = start.y - end.y
  const lengthSq = dx * dx + dy * dy
  let t = lengthSq === 0 ? 0 :
    ((point.x - start.x) * (end.x - start.x) +
      (point.y - start.y) * (end.y - start.y)) / lengthSq
  t = Math.max(0, Math.min(1, t))
  const projectionX = start.x + t * (end.x - start.x)
  const projectionY = start.y + t * (end.y - start.y)
  return (point.x - projectionX) ** 2 + (point.y - projectionY) ** 2
}

// Reference the original Set-based query independently of the query markers.
// Read buckets so the oracle retains the original encounter order and duplicate
// string-ID behavior, which a brute-force scan of route geometry would miss.
const getReferenceConflicts = (
  index: HighDensityRouteSpatialIndex,
  start: Point,
  end: Point | undefined,
  margin: number,
): Conflict[] => {
  const state = index as unknown as IndexState
  const broadMargin = margin + state.maximumCopperRadius
  const endpoint = end ?? start
  const minX = Math.floor((Math.min(start.x, endpoint.x) - broadMargin) / state.CELL_SIZE)
  const maxX = Math.floor((Math.max(start.x, endpoint.x) + broadMargin + 1e-9) / state.CELL_SIZE)
  const minY = Math.floor((Math.min(start.y, endpoint.y) - broadMargin) / state.CELL_SIZE)
  const maxY = Math.floor((Math.max(start.y, endpoint.y) + broadMargin + 1e-9) / state.CELL_SIZE)
  const segments = new Set<string>()
  const vias = new Set<string>()
  const results = new Map<string, { route: HighDensityRoute; distanceSq: number }>()
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = `${x}x${y}`
      for (const segment of state.segmentBuckets.get(key) ?? []) {
        if (segments.has(segment.segmentId)) continue
        segments.add(segment.segmentId)
        const [a, b] = segment.segment
        if (a.z !== b.z || a.z !== start.z || (end && start.z !== end.z)) continue
        const distanceSq = !end ? pointDistanceSq(start, a, b) :
          doSegmentsIntersect(start, end, a, b) ? 0 : Math.min(
            pointDistanceSq(start, a, b), pointDistanceSq(end, a, b),
            pointDistanceSq(a, start, end), pointDistanceSq(b, start, end),
          )
        const separation = margin + segment.parentRoute.traceThickness / 2
        const existing = results.get(segment.parentRoute.connectionName)
        if (distanceSq < separation * separation && (!existing || distanceSq < existing.distanceSq)) {
          results.set(segment.parentRoute.connectionName, { route: segment.parentRoute, distanceSq })
        }
      }
      for (const via of state.viaBuckets.get(key) ?? []) {
        if (vias.has(via.viaId)) continue
        vias.add(via.viaId)
        const distanceSq = end ? pointDistanceSq(via, start, end) :
          (start.x - via.x) ** 2 + (start.y - via.y) ** 2
        const separation = margin + via.parentRoute.viaDiameter / 2
        const existing = results.get(via.parentRoute.connectionName)
        if (distanceSq < separation * separation && (!existing || distanceSq < existing.distanceSq)) {
          results.set(via.parentRoute.connectionName, { route: via.parentRoute, distanceSq })
        }
      }
    }
  }
  return [...results.values()].map(({ route, distanceSq }) => ({
    conflictingRoute: route,
    distance: Math.sqrt(distanceSq),
  }))
}

test("query markers retain exact Set deduplication across additions, removals, and rollover", () => {
  let randomState = 42
  const random = (): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState / 0x1_0000_0000
  }
  const routes: HighDensityRoute[] = Array.from({ length: 50 }, (_, index) => ({
    connectionName: `route_${index % 25}`,
    traceThickness: 0.1 + random() * 0.5,
    viaDiameter: 0.2 + random() * 0.8,
    route: Array.from({ length: 5 }, () => ({
      x: random() * 8 - 4, y: random() * 8 - 4, z: Math.floor(random() * 3),
    })),
    vias: Array.from({ length: 2 }, () => ({ x: random() * 8 - 4, y: random() * 8 - 4 })),
  }))
  const index = new HighDensityRouteSpatialIndex(routes.slice(0, 40), 0.5)
  for (const route of routes.slice(40)) index.addRoute(route)
  for (let phase = 0; phase < 3; phase++) {
    if (phase === 1) {
      index.removeRoute("route_3")
      index.removeRoute("route_10")
      index.addRoute(routes[3]!)
      // A caller may rename a route after insertion. Removing that route must
      // retain the shared marker for other entries with its original IDs.
      routes[0]!.connectionName = "renamed_route"
      index.removeRoute("renamed_route")
      index.addRoute({ ...routes[0]!, connectionName: "route_0" })
    }
    if (phase === 2) {
      ;(index as unknown as IndexState).queryNumber = Number.MAX_SAFE_INTEGER - 1
    }
    for (let query = 0; query < 150; query++) {
      const start = { x: random() * 8 - 4, y: random() * 8 - 4, z: Math.floor(random() * 3) }
      const end = { x: random() * 8 - 4, y: random() * 8 - 4, z: Math.floor(random() * 3) }
      const margin = random() * 0.6
      expect(index.getConflictingRoutesNearPoint(start, margin)).toEqual(
        getReferenceConflicts(index, start, undefined, margin),
      )
      expect(index.getConflictingRoutesForSegment(start, end, margin)).toEqual(
        getReferenceConflicts(index, start, end, margin),
      )
    }
  }
})
