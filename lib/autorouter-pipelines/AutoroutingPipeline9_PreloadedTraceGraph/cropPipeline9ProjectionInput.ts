import type { RelaxTraceClearanceSolver } from "@tscircuit/repair04"

type ProjectionInput = ConstructorParameters<typeof RelaxTraceClearanceSolver>[0]
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** Retain collision and same-net junction context for one projection partition. */
export const cropPipeline9ProjectionInput = (
  input: ProjectionInput,
  assignments: ReadonlyMap<string, number>,
  partition: number,
): { input: ProjectionInput; routeIndexes: number[] } => {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  let maxRadius = 0
  const includePoint = (point: { x: number; y: number }): void => {
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.maxY = Math.max(bounds.maxY, point.y)
  }
  for (const route of input.routes) {
    maxRadius = Math.max(maxRadius, route.traceThickness / 2, route.viaDiameter / 2)
    for (const [index, point] of route.route.entries()) {
      maxRadius = Math.max(maxRadius, ((point as typeof point & { traceThickness?: number }).traceThickness ?? route.traceThickness) / 2)
      if (assignments.get(`${point.x},${point.y}`) !== partition) continue
      includePoint(point)
      if (index > 0) includePoint(route.route[index - 1]!)
      if (index + 1 < route.route.length) includePoint(route.route[index + 1]!)
    }
  }
  if (!Number.isFinite(bounds.minX)) throw new Error("Projection partition has no points")
  // Every endpoint may move by at most 0.25 on each axis in repair04.
  // Include the same conservative distance used to prepare segment pairs.
  const margin = 2 * maxRadius + Math.max(input.traceClearance ?? 0.1, input.viaClearance ?? 0.1) + 2 * Math.SQRT2 * 0.25
  bounds.minX -= margin
  bounds.minY -= margin
  bounds.maxX += margin
  bounds.maxY += margin

  const makeNetGroups = (includeObstacles: boolean): string[] => {
    const parent = new Map<string, string>()
    const find = (name: string): string => {
      const previous = parent.get(name)
      if (previous === undefined) { parent.set(name, name); return name }
      if (previous === name) return name
      const root = find(previous)
      parent.set(name, root)
      return root
    }
    const union = (names: Array<string | undefined>): void => {
      const present = names.filter((name): name is string => typeof name === "string" && name.length > 0)
      if (present.length === 0) return
      const root = find(present[0]!)
      for (const name of present) parent.set(find(name), root)
    }
    for (const connection of input.srj.connections) {
      const metadata = connection as typeof connection & { __rootConnectionNames?: string[]; __netConnectionName?: string }
      union([
        connection.name,
        connection.rootConnectionName,
        connection.netConnectionName,
        metadata.__netConnectionName,
        ...(connection.mergedConnectionNames ?? []),
        ...(metadata.__rootConnectionNames ?? []),
        ...(includeObstacles ? connection.pointsToConnect.flatMap((point) => [point.pointId, point.pcb_port_id]) : []),
      ])
    }
    if (includeObstacles) for (const obstacle of input.srj.obstacles) union(obstacle.connectedTo)
    for (const route of input.routes) union([route.connectionName, route.rootConnectionName])
    if (!includeObstacles) for (const trace of input.srj.traces ?? []) {
      const metadata = trace as typeof trace & { connectsTo?: string[] }
      union([trace.connection_name, ...(metadata.connectsTo ?? [])])
    }
    return input.routes.map((route) => find(route.connectionName))
  }
  const declaredNets = makeNetGroups(false)
  const electricalNets = makeNetGroups(true)
  const selected = new Set<number>()
  for (const [routeIndex, route] of input.routes.entries()) {
    if (route.route.some((point, index) => {
      if (assignments.get(`${point.x},${point.y}`) === partition) return true
      const previous = route.route[index - 1]
      return previous !== undefined &&
        Math.max(point.x, previous.x) >= bounds.minX &&
        Math.min(point.x, previous.x) <= bounds.maxX &&
        Math.max(point.y, previous.y) >= bounds.minY &&
        Math.min(point.y, previous.y) <= bounds.maxY
    })) selected.add(routeIndex)
  }
  // Same-net routes may connect through immutable endpoints and remote pads.
  // Include the transitive closure under both of repair04's net definitions.
  const declared = new Set<string>()
  const electrical = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const index of selected) {
      declared.add(declaredNets[index]!)
      electrical.add(electricalNets[index]!)
    }
    for (let index = 0; index < input.routes.length; index++) {
      if (!selected.has(index) && (declared.has(declaredNets[index]!) || electrical.has(electricalNets[index]!))) {
        selected.add(index)
        changed = true
      }
    }
  }
  const routeIndexes = [...selected].sort((a, b) => a - b)
  return {
    routeIndexes,
    input: {
      ...input,
      routes: routeIndexes.map((index) => input.routes[index]!),
      lockedPointIndices: routeIndexes.map((index) =>
        input.routes[index]!.route.map((point, pointIndex) =>
          Boolean(input.lockedPointIndices[index]![pointIndex]) ||
          assignments.get(`${point.x},${point.y}`) !== partition,
        ),
      ),
    },
  }
}
