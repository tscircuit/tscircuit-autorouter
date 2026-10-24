type PriorityPoint = { x: number; y: number; z: number }
export type PriorityTask = { connectionName: string; rootConnectionName?: string; points: PriorityPoint[] }
type PriorityTaskGroup = Omit<PriorityTask, "points"> & { points: readonly PriorityPoint[] }

/** Match native Intra's pop order and queueExtraBranches star decomposition.
 * Internal array indices distinguish branches; electrical identities never
 * acquire synthetic suffixes. Exact-XY layer changes retain native fast-via
 * handling; zero-length and approximate-XY terminal cases stay native.
 */
export function decomposePriorityTasks(groups: readonly PriorityTaskGroup[], charge: (name: string, count?: number) => void): PriorityTask[] | null {
  const tasks: PriorityTask[] = []
  for (let group = groups.length - 1; group >= 0; group--) {
    charge("priorityDecompositionGroups")
    const connection = groups[group]
    if (connection.points.length < 2) return null
    let points: readonly PriorityPoint[] = connection.points
    for (const point of points) {
      charge("priorityDecompositionPoints")
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isSafeInteger(point.z)) return null
    }
    if (points.length > 2) {
      const seen = new Set<string>()
      const deduped: PriorityPoint[] = []
      for (const point of connection.points) {
        charge("priorityDecompositionDedupes")
        const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(point)
      }
      points = deduped
      // Native only queues extra branches if at least three unique points.
      // Its degenerate nonbranch behavior is deliberately outside this slice.
      if (points.length < 3) return null
    }
    for (let endpoint = points.length - 1; endpoint >= 1; endpoint--) {
      charge("priorityDecompositionBranches")
      const a = points[0], b = points[endpoint]
      const nearSameXY = Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
      if (nearSameXY && (a.z === b.z || a.x !== b.x || a.y !== b.y)) return null
      tasks.push({ connectionName: connection.connectionName, rootConnectionName: connection.rootConnectionName,
        points: [{ ...a }, { ...b }] })
    }
  }
  return tasks.length >= 2 ? tasks : null
}
