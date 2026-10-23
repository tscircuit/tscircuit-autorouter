import type { Point3 } from "@tscircuit/math-utils"
import { PriorityQueue } from "lib/data-structures/PriorityQueue"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { MAX_STITCH_GAP_DISTANCE_3, MAX_TERMINAL_STITCH_GAP_DISTANCE_3 } from "./routeStitchingShared"
import { reverseRoutePoints } from "./SingleHighDensityRouteStitchSolver3"

type TerminalPoint = Point3 & { pcb_port_id?: string }
type Endpoint = { point: Point3; owned: boolean; tags: Set<string>; edges: Edge[] }
type Edge = { next: number; cost: number; routeIndex?: number }
type DeclaredStitchBridge = HighDensityIntraNodeRoute & { generatedStitchBridge: true }

/** Select an owned, layer-aware path; repeated regional fragments are not a walk order. */
export function selectDeclaredTerminalPath(input: {
  connectionName: string
  routes: HighDensityIntraNodeRoute[]
  start: TerminalPoint
  end: TerminalPoint
}): HighDensityIntraNodeRoute[] {
  const endpoints: Endpoint[] = []
  const terminalIds = new Set([input.start.pcb_port_id, input.end.pcb_port_id].filter((id): id is string => id !== undefined))
  const byPosition = new Map<string, number>()
  const register = (point: Point3, tag?: string): number => {
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`Declared terminal path has invalid geometry for ${input.connectionName}`)
    const key = JSON.stringify([point.x, point.y, point.z])
    const existing = byPosition.get(key)
    if (existing !== undefined) {
      if (tag) endpoints[existing]!.tags.add(tag)
      return existing
    }
    const id = endpoints.length
    endpoints.push({ point, owned: true, tags: new Set(tag ? [tag] : []), edges: [] })
    byPosition.set(key, id)
    return id
  }
  let totalLength = 0
  for (const [index, route] of input.routes.entries()) {
    const first = route.route[0]
    const last = route.route.at(-1)
    if (!first || !last) throw new Error(`Declared terminal path has empty owned fragment for ${input.connectionName}`)
    if (route.connectionName !== input.connectionName) throw new Error(`Declared terminal path has a foreign fragment for ${input.connectionName}`)
    // Route roles are authoritative. Point-lock contradictions retain the
    // existing Single solver validation lifecycle when the walk is consumed.
    const a = register(first, route.startPcbPortId ?? (first.pcb_port_id && terminalIds.has(first.pcb_port_id) ? first.pcb_port_id : undefined))
    const b = register(last, route.endPcbPortId ?? (last.pcb_port_id && terminalIds.has(last.pcb_port_id) ? last.pcb_port_id : undefined))
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
  const ownedEndpointCount = endpoints.length
  for (const vertex of endpoints) for (const tag of vertex.tags) if (!terminalIds.has(tag)) throw new Error(`Declared terminal path has unknown PCB terminal ${tag} for ${input.connectionName}`)
  // Declared terminal roles never merge into a rounded owned vertex. Their
  // attachment domain is selected before graph search, so a cheap generic gap
  // cannot attach source A to the owned endpoint explicitly labelled B.
  const attachTerminal = (point: TerminalPoint): number => {
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`Declared terminal path has invalid terminal for ${input.connectionName}`)
    const matchingIdentity = point.pcb_port_id === undefined ? [] : endpoints.slice(0, ownedEndpointCount).flatMap((vertex, id) => vertex.tags.has(point.pcb_port_id!) ? [id] : [])
    const candidates = matchingIdentity.length ? matchingIdentity : endpoints.slice(0, ownedEndpointCount).flatMap((vertex, id) => vertex.tags.size === 0 ? [id] : [])
    const compatible = candidates.filter((id) => endpoints[id]!.point.z === point.z && Math.hypot(endpoints[id]!.point.x - point.x, endpoints[id]!.point.y - point.y) <= MAX_TERMINAL_STITCH_GAP_DISTANCE_3)
    if (!compatible.length) throw new Error(`Declared terminal path has no compatible ${point.pcb_port_id ?? "untagged"} terminal attachment for ${input.connectionName}`)
    let selected = compatible
    if (!matchingIdentity.length) {
      // Untagged legacy demands have no PCB identity to recover. An exact or
      // rounded endpoint, otherwise the unique nearest eligible endpoint, is
      // their explicit bounded geometric attachment policy. Ambiguity is an
      // unsupported domain, never a search-time guess or a failed-tag fallback.
      const distance = (id: number): number => Math.hypot(endpoints[id]!.point.x - point.x, endpoints[id]!.point.y - point.y)
      const exact = compatible.filter((id) => distance(id) === 0)
      const rounded = compatible.filter((id) => endpoints[id]!.point.x === Number(point.x.toFixed(3)) && endpoints[id]!.point.y === Number(point.y.toFixed(3)))
      const minimum = Math.min(...compatible.map(distance))
      selected = exact.length ? exact : rounded.length ? rounded : compatible.filter((id) => distance(id) === minimum)
      if (selected.length !== 1) throw new Error(`Declared terminal path has ambiguous untagged terminal attachment for ${input.connectionName}`)
    }
    const terminal = endpoints.length
    endpoints.push({ point, owned: false, tags: new Set(point.pcb_port_id ? [point.pcb_port_id] : []), edges: [] })
    for (const id of selected) {
      const gap = Math.hypot(endpoints[id]!.point.x - point.x, endpoints[id]!.point.y - point.y)
      const cost = totalLength + 1 + gap
      endpoints[terminal]!.edges.push({ next: id, cost })
      endpoints[id]!.edges.push({ next: terminal, cost })
    }
    return terminal
  }
  const start = attachTerminal(input.start)
  const end = attachTerminal(input.end)
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
  for (let i = 0; i < ownedEndpointCount; i++) {
    for (const edge of endpoints[i]!.edges) if (edge.next < ownedEndpointCount) parent[find(i)] = find(edge.next)
  }
  const cellSize = MAX_TERMINAL_STITCH_GAP_DISTANCE_3
  const buckets = new Map<string, number[]>()
  for (let a = 0; a < ownedEndpointCount; a++) {
    const vertex = endpoints[a]!
    const x = Math.floor(vertex.point.x / cellSize)
    const y = Math.floor(vertex.point.y / cellSize)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const b of buckets.get(`${vertex.point.z}:${x + dx}:${y + dy}`) ?? []) {
          const other = endpoints[b]!
          // Gaps only reconnect separate fragments. They cannot shortcut an
          // already connected owned route, or create a layer transition.
          if (find(a) === find(b)) continue
          const gap = Math.hypot(vertex.point.x - other.point.x, vertex.point.y - other.point.y)
          const limit = MAX_STITCH_GAP_DISTANCE_3
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
      if (from.x === to.x && from.y === to.y && from.z === to.z) {
        cursor = edge.from
        continue
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
