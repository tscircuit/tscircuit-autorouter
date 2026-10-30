import {
  extractRepairRegion,
  type RelaxTraceClearanceSolver,
} from "@tscircuit/repair04"

type ProjectionInput = ConstructorParameters<typeof RelaxTraceClearanceSolver>[0]

type Point = { x: number; y: number }
type ProjectionPoint = Point & { count: number }

type ProjectionRegion = {
  input: ProjectionInput
  sourceRouteIndexes: number[]
  sourceSpans: Array<{ firstSegment: number; lastSegment: number }>
}

/** Select error-centered windows and assign only vertices inside their collars. */
export const planPipeline9ProjectionWindows = (
  input: ProjectionInput,
  points: ReadonlyMap<string, ProjectionPoint>,
  centers: readonly Point[],
): { centers: Point[]; assignments: Map<string, number> } => {
  let diameter = 0
  for (const route of input.routes) {
    diameter = Math.max(diameter, route.traceThickness, route.viaDiameter)
    for (const point of route.route) {
      diameter = Math.max(diameter, (point as typeof point & { traceThickness?: number }).traceThickness ?? route.traceThickness)
    }
  }
  const clearance = Math.max(
    input.srj.defaultObstacleMargin ?? 0.2,
    input.srj.minTraceToPadEdgeClearance ?? 0,
    input.srj.minTraceToHoleEdgeClearance ?? 0,
    input.srj.minViaEdgeToPadEdgeClearance ?? 0,
  )
  const size = Math.max(10, 2 * (diameter + clearance) + 1)
  const radius = size / 2 - Math.max(0.5, diameter + clearance) - 1e-6
  const candidates = centers.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  const unassigned = new Map(points)
  const clusters: Array<{ center: Point; points: Array<[string, ProjectionPoint]>; lanes: number }> = []
  while (clusters.length < 4 && unassigned.size > 0) {
    let best: Point | undefined
    let bestScore = 0
    for (const center of candidates) {
      let score = 0
      for (const point of unassigned.values()) {
        if (Math.abs(point.x - center.x) <= radius && Math.abs(point.y - center.y) <= radius) score += point.count
      }
      if (score > bestScore) { best = center; bestScore = score }
    }
    if (!best) break
    const clusterPoints: Array<[string, ProjectionPoint]> = []
    for (const [key, point] of unassigned) {
      if (Math.abs(point.x - best.x) <= radius && Math.abs(point.y - best.y) <= radius) {
        clusterPoints.push([key, point])
        unassigned.delete(key)
      }
    }
    clusters.push({ center: best, points: clusterPoints, lanes: 1 })
  }
  while (clusters.reduce((sum, cluster) => sum + cluster.lanes, 0) < 4) {
    const candidate = clusters.filter((cluster) => cluster.points.length > cluster.lanes)
      .sort((a, b) => b.points.length / b.lanes - a.points.length / a.lanes)[0]
    if (!candidate) break
    candidate.lanes++
  }
  const workerCenters: Point[] = []
  const assignments = new Map<string, number>()
  for (const cluster of clusters) {
    cluster.points.sort(([, a], [, b]) => a.x - b.x || a.y - b.y)
    const firstLane = workerCenters.length
    for (let i = 0; i < cluster.lanes; i++) workerCenters.push(cluster.center)
    for (const [index, [key]] of cluster.points.entries()) {
      assignments.set(key, firstLane + Math.floor(index * cluster.lanes / cluster.points.length))
    }
  }
  return { centers: workerCenters, assignments }
}

/** Slice the board into guarded local candidate problems with fixed collars. */
export const createPipeline9ProjectionRegions = (
  input: ProjectionInput,
  assignments: ReadonlyMap<string, number>,
  centers: readonly Point[],
): ProjectionRegion[] => {
  let maxDiameter = 0
  const originalLocks = input.routes.map((route, routeIndex) => {
    maxDiameter = Math.max(maxDiameter, route.traceThickness, route.viaDiameter)
    const locks = new Map<string, boolean>()
    for (const [pointIndex, point] of route.route.entries()) {
      const thickness = (point as typeof point & { traceThickness?: number }).traceThickness
      maxDiameter = Math.max(maxDiameter, thickness ?? route.traceThickness)
      const key = `${point.x},${point.y},${point.z}`
      locks.set(key, (locks.get(key) ?? false) || Boolean(input.lockedPointIndices[routeIndex]![pointIndex]))
    }
    return locks
  })
  const clearance = Math.max(
    input.srj.defaultObstacleMargin ?? 0.2,
    input.srj.minTraceToPadEdgeClearance ?? 0,
    input.srj.minTraceToHoleEdgeClearance ?? 0,
    input.srj.minViaEdgeToPadEdgeClearance ?? 0,
  )
  const size = Math.max(10, 2 * (maxDiameter + clearance) + 1)
  return centers.map((center, partition): ProjectionRegion => {
    const { x, y } = center
    const region = extractRepairRegion({
      srj: input.srj,
      routes: input.routes,
      bounds: { minX: x - size / 2, maxX: x + size / 2, minY: y - size / 2, maxY: y + size / 2 },
    })
    const sourceRouteIndexes = region.routeMappings.map((mapping) => mapping.sourceRouteIndex)
    return {
      sourceRouteIndexes,
      sourceSpans: region.routeMappings.map((mapping) => ({
        firstSegment: mapping.start.segmentIndex,
        lastSegment: mapping.end.segmentIndex,
      })),
      input: {
        ...input,
        routes: region.routes,
        lockedPointIndices: region.routes.map((route, localIndex) =>
          route.route.map((point, pointIndex) => {
            const sourceLocks = originalLocks[sourceRouteIndexes[localIndex]!]!
            const sourceLock = sourceLocks.get(`${point.x},${point.y},${point.z}`)
            return Boolean(region.lockedPointIndices[localIndex]![pointIndex]) ||
              sourceLock === undefined || sourceLock ||
              assignments.get(`${point.x},${point.y}`) !== partition
          }),
        ),
      },
    }
  })
}
