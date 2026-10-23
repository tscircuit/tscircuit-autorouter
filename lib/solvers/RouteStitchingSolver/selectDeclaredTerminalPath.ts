import type { Point3 } from "@tscircuit/math-utils"
import { PriorityQueue } from "lib/data-structures/PriorityQueue"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { MAX_STITCH_GAP_DISTANCE_3, MAX_TERMINAL_STITCH_GAP_DISTANCE_3 } from "./routeStitchingShared"
import { reverseRoutePoints } from "./SingleHighDensityRouteStitchSolver3"

type Endpoint = { point: Point3; owned: boolean; terminal: boolean; edges: Edge[] }
type Edge = { next: number; cost: number; routeIndex?: number }
type DeclaredStitchBridge = HighDensityIntraNodeRoute & { generatedStitchBridge: true }

/** Select an owned, layer-aware path; repeated regional fragments are not a walk order. */
export function selectDeclaredTerminalPath(input: {
  connectionName: string
  routes: HighDensityIntraNodeRoute[]
  start: Point3
  end: Point3
}): HighDensityIntraNodeRoute[] {
  const endpoints: Endpoint[] = []
  const byPosition = new Map<string, number>()
  const register = (point: Point3, owned: boolean, terminal: boolean): number => {
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`Declared terminal path has invalid geometry for ${input.connectionName}`)
    const key = JSON.stringify([point.x, point.y, point.z])
    const existing = byPosition.get(key)
    if (existing !== undefined) {
      endpoints[existing]!.owned ||= owned
      endpoints[existing]!.terminal ||= terminal
      return existing
    }
    const id = endpoints.length
    endpoints.push({ point, owned, terminal, edges: [] })
    byPosition.set(key, id)
    return id
  }
  let totalLength = 0
  for (const [index, route] of input.routes.entries()) {
    const first = route.route[0]
    const last = route.route.at(-1)
    if (!first || !last) throw new Error(`Declared terminal path has empty owned fragment for ${input.connectionName}`)
    const a = register(first, true, false)
    const b = register(last, true, false)
    let length = 1e-6
    for (let i = 1; i < route.route.length; i++) {
      const p = route.route[i - 1]!
      const q = route.route[i]!
      if (![q.x, q.y, q.z].every(Number.isFinite)) throw new Error(`Declared terminal path has invalid fragment for ${input.connectionName}`)
      length += Math.hypot(q.x - p.x, q.y - p.y) + (q.z === p.z ? 0 : 1)
    }
    totalLength += length
    endpoints[a]!.edges.push({ next: b, cost: length, routeIndex: index })
    endpoints[b]!.edges.push({ next: a, cost: length, routeIndex: index })
  }
  const start = register(input.start, false, true)
  const end = register(input.end, false, true)
  const parent = endpoints.map((_, index) => index)
  const find = (id: number): number => {
    let root = id
    while (parent[root] !== root) root = parent[root]!
    let cursor = id
    while (cursor !== root) {
      const next = parent[cursor]!
      parent[cursor] = root
      cursor = next
    }
    return root
  }
  for (let i = 0; i < endpoints.length; i++) {
    for (const edge of endpoints[i]!.edges) parent[find(i)] = find(edge.next)
  }
  const cellSize = MAX_TERMINAL_STITCH_GAP_DISTANCE_3
  const buckets = new Map<string, number[]>()
  for (let a = 0; a < endpoints.length; a++) {
    const vertex = endpoints[a]!
    const x = Math.floor(vertex.point.x / cellSize)
    const y = Math.floor(vertex.point.y / cellSize)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const b of buckets.get(`${vertex.point.z}:${x + dx}:${y + dy}`) ?? []) {
          const other = endpoints[b]!
          // Gaps only reconnect separate fragments. They cannot shortcut an
          // already connected owned route, or create a layer transition.
          if (find(a) === find(b) || (!vertex.owned && !other.owned)) continue
          const gap = Math.hypot(vertex.point.x - other.point.x, vertex.point.y - other.point.y)
          const limit = vertex.terminal || other.terminal ? MAX_TERMINAL_STITCH_GAP_DISTANCE_3 : MAX_STITCH_GAP_DISTANCE_3
          if (gap > limit) continue
          const cost = totalLength + 1 + gap
          vertex.edges.push({ next: b, cost })
          other.edges.push({ next: a, cost })
        }
      }
    }
    const key = `${vertex.point.z}:${x}:${y}`
    const bucket = buckets.get(key) ?? []
    bucket.push(a)
    buckets.set(key, bucket)
  }
  const costs = new Float64Array(endpoints.length).fill(Number.POSITIVE_INFINITY)
  costs[start] = 0
  const previous = new Map<number, { from: number; routeIndex?: number }>()
  const queue = new PriorityQueue<{ id: number; f: number }>([], Number.POSITIVE_INFINITY)
  queue.enqueue({ id: start, f: 0 })
  while (!queue.isEmpty()) {
    const current = queue.dequeue()!
    if (current.f !== costs[current.id]) continue
    if (current.id === end) break
    for (const edge of endpoints[current.id]!.edges) {
      const cost = current.f + edge.cost
      if (cost >= costs[edge.next]!) continue
      costs[edge.next] = cost
      previous.set(edge.next, { from: current.id, routeIndex: edge.routeIndex })
      queue.enqueue({ id: edge.next, f: cost })
    }
  }
  if (!Number.isFinite(costs[end])) throw new Error(`Declared terminal path cannot connect owned fragments for ${input.connectionName}`)
  const selected: HighDensityIntraNodeRoute[] = []
  const bridgeWidth = Math.max(...input.routes.map((route) => route.traceThickness))
  const bridgeViaDiameter = Math.max(...input.routes.map((route) => route.viaDiameter))
  let cursor = end
  while (cursor !== start) {
    const edge = previous.get(cursor)
    if (!edge) throw new Error(`Declared terminal path lost predecessor for ${input.connectionName}`)
    if (edge.routeIndex !== undefined) {
      const route = input.routes[edge.routeIndex]!
      const from = endpoints[edge.from]!.point
      const first = route.route[0]!
      const forward = first.x === from.x && first.y === from.y && first.z === from.z
      selected.push(forward ? route : { ...route,
        route: reverseRoutePoints(route.route),
        startPcbPortId: route.endPcbPortId,
        endPcbPortId: route.startPcbPortId,
      })
    } else {
      const from = endpoints[edge.from]!.point
      const to = endpoints[cursor]!.point
      if (from.z !== to.z || !Number.isFinite(bridgeWidth) || bridgeWidth <= 0) {
        throw new Error(`Declared terminal path has invalid planar bridge for ${input.connectionName}`)
      }
      const bridge: DeclaredStitchBridge = {
        connectionName: input.connectionName,
        rootConnectionName: input.routes[0]!.rootConnectionName,
        traceThickness: bridgeWidth,
        viaDiameter: bridgeViaDiameter,
        route: [{ x: from.x, y: from.y, z: from.z }, { x: to.x, y: to.y, z: to.z }],
        vias: [],
        generatedStitchBridge: true,
      }
      selected.push(bridge)
    }
    cursor = edge.from
  }
  return selected.reverse()
}
