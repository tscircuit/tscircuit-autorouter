import {
  extractRepairRegion,
  type RelaxTraceClearanceSolver,
} from "@tscircuit/repair04"

type ProjectionInput = ConstructorParameters<typeof RelaxTraceClearanceSolver>[0]

type ProjectionRegion = {
  input: ProjectionInput
  sourceRouteIndexes: number[]
  sourceSpans: Array<{ firstSegment: number; lastSegment: number }>
}

/** Slice the board into guarded local candidate problems with fixed collars. */
export const createPipeline9ProjectionRegions = (
  input: ProjectionInput,
  assignments: ReadonlyMap<string, number>,
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
  return Array.from({ length: 4 }, (_, partition): ProjectionRegion => {
    const points: Array<{ x: number; y: number }> = []
    for (const [key, owner] of assignments) {
      if (owner !== partition) continue
      const [x, y] = key.split(",").map(Number)
      points.push({ x: x!, y: y! })
    }
    if (points.length === 0) throw new Error("Projection partition has no points")
    const xs = points.map((point) => point.x).sort((a, b) => a - b)
    const ys = points.map((point) => point.y).sort((a, b) => a - b)
    const x = xs[Math.floor(xs.length / 2)]!
    const y = ys[Math.floor(ys.length / 2)]!
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
