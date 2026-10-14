import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { createHexGrid } from "./hexGrid"
import { createOctGrid } from "./octGrid"

export type Point = { x: number; y: number }
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
export interface GridProvider {
  kind: string
  pitch: number
  directions: number[][]
  point(i: number, j: number): Point
  nearest(x: number, y: number): [number, number]
  distance(i: number, j: number, ti: number, tj: number): number
}
export interface RouterConfig {
  grid: "hex" | "oct"
  pitch: number
  clearance: number
  timeLimit: number
  viaDiameter: number
  viaPenalty: number
  breakoutCandidates: number
}
export const defaultConfig: RouterConfig = {
  grid: "hex", pitch: 0.2, clearance: 0.1, timeLimit: 60,
  viaDiameter: 0.3, viaPenalty: 2, breakoutCandidates: 16,
}
export type Terminal = Point & { layer?: string; layers?: string[]; pointId?: string; pcb_port_id?: string }
type Connection = { name: string; source_trace_id?: string; pointsToConnect: Terminal[]; width?: number; nominalTraceWidth?: number }
export type Obstacle = { type: string; center: Point; width: number; height: number; layers: string[]; connectedTo?: string[]; ccwRotationDegrees?: number }
export type Dataset = { bounds: Bounds; layerCount?: number; minTraceWidth?: number; outline?: Point[]; obstacles: Obstacle[]; connections: Connection[]; [key: string]: unknown }
export type WirePoint = Point & { route_type: "wire"; width: number; layer: string; outer_diameter?: never; from_layer?: never; to_layer?: never }
export type ViaPoint = Point & { route_type: "via"; from_layer: string; to_layer: string; outer_diameter: number; hole_diameter: number; layer?: never; width?: never }
export type TracePoint = WirePoint | ViaPoint
export type PcbTrace = { type: "pcb_trace"; pcb_trace_id: string; source_trace_id: string; connection_name: string; route: TracePoint[] }
type FailedConnection = { name: string; reason: "time_limit" | "no_legal_breakout" | "no_path" | "unconnected_branch"; connectedTerminalCount: number }
export type RouterOutput = Dataset & { traces: PcbTrace[]; experiment: {
  elapsedMs: number; completedConnectionNames: string[]; failedConnections: FailedConnection[];
  noRouteRequiredConnectionNames: string[]; status: "time_limit" | "partial" | "completed";
  config: RouterConfig; layerNames: string[]; gridNodeCount: number; gridStateCount: number;
  breakoutStats: { attemptedTerminals: number; failedTerminals: number; candidateCount: number; totalExpandedStates: number };
  algorithm: string;
} }
type Copper = { net: string; layers: number[]; a: Point; b: Point; radius: number }
type IndexedObstacle = Obstacle & { net: string; activeLayers: Set<number>; polygon?: Point[]; capsule?: [Point, Point, number] }
type Breakout = { id: number; distance: number }
type RouteResult = { ids: number[]; start: Breakout; end?: Breakout; expanded: number } | null
const EPS = 1e-8

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = dx * dx + dy * dy > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
const cross = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) && ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function rotate(p: Point, o: Obstacle): Point {
  const r = (o.ccwRotationDegrees ?? 0) * Math.PI / 180, co = Math.cos(r), si = Math.sin(r)
  return { x: o.center.x + co * p.x - si * p.y, y: o.center.y + si * p.x + co * p.y }
}
function obstacleGeometry(o: Obstacle): Pick<IndexedObstacle, "polygon" | "capsule"> {
  if (o.type === "oval") {
    const r = Math.min(o.width, o.height) / 2
    const d = Math.max(o.width, o.height) / 2 - r
    return { capsule: o.width >= o.height ? [rotate({ x: -d, y: 0 }, o), rotate({ x: d, y: 0 }, o), r] : [rotate({ x: 0, y: -d }, o), rotate({ x: 0, y: d }, o), r] }
  }
  return { polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => rotate({ x: x * o.width / 2, y: y * o.height / 2 }, o)) }
}
export function segmentObstacleDistance(a: Point, b: Point, o: Obstacle): number {
  const geometry = (o as IndexedObstacle).polygon || (o as IndexedObstacle).capsule ? o as IndexedObstacle : { ...o, ...obstacleGeometry(o) }
  if (geometry.capsule) return Math.max(0, segmentDistance(a, b, geometry.capsule[0], geometry.capsule[1]) - geometry.capsule[2])
  const polygon = geometry.polygon!
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return 0
  let distance = Infinity
  for (let i = 0; i < polygon.length; i++) distance = Math.min(distance, segmentDistance(a, b, polygon[i], polygon[(i + 1) % polygon.length]))
  return distance
}

class SpatialIndex<T> {
  bins = new Map<string, T[]>()
  constructor(readonly cell = 1) {}
  add(value: T, bounds: Bounds): void {
    for (let i = Math.floor(bounds.minX / this.cell); i <= Math.floor(bounds.maxX / this.cell); i++) {
      for (let j = Math.floor(bounds.minY / this.cell); j <= Math.floor(bounds.maxY / this.cell); j++) {
        const key = `${i},${j}`, bin = this.bins.get(key)
        if (bin) bin.push(value); else this.bins.set(key, [value])
      }
    }
  }
  query(bounds: Bounds): T[] {
    const values = new Set<T>()
    for (let i = Math.floor(bounds.minX / this.cell); i <= Math.floor(bounds.maxX / this.cell); i++) {
      for (let j = Math.floor(bounds.minY / this.cell); j <= Math.floor(bounds.maxY / this.cell); j++) {
        const bin = this.bins.get(`${i},${j}`)
        if (bin) for (const value of bin) values.add(value)
      }
    }
    return [...values]
  }
}
function segmentBounds(a: Point, b: Point, margin: number): Bounds {
  return { minX: Math.min(a.x, b.x) - margin, maxX: Math.max(a.x, b.x) + margin, minY: Math.min(a.y, b.y) - margin, maxY: Math.max(a.y, b.y) + margin }
}
class UnionFind {
  parents = new Map<string, string>()
  find(id: string): string { const p = this.parents.get(id); if (!p) { this.parents.set(id, id); return id } if (p === id) return id; const root = this.find(p); this.parents.set(id, root); return root }
  union(a: string, b: string): void { const ar = this.find(a), br = this.find(b); if (ar !== br) this.parents.set(br, ar) }
  group(ids: string[]): void { for (let i = 1; i < ids.length; i++) this.union(ids[0], ids[i]) }
}
class MinHeap {
  ids: number[] = []; priorities: number[] = []
  push(id: number, priority: number): void {
    let i = this.ids.length; this.ids.push(id); this.priorities.push(priority)
    while (i) { const p = (i - 1) >> 1; if (this.priorities[p] <= priority) break; this.ids[i] = this.ids[p]; this.priorities[i] = this.priorities[p]; i = p }
    this.ids[i] = id; this.priorities[i] = priority
  }
  pop(): [number, number] {
    const result: [number, number] = [this.ids[0], this.priorities[0]], id = this.ids.pop()!, priority = this.priorities.pop()!
    if (this.ids.length) {
      let i = 0
      while (i * 2 + 1 < this.ids.length) { let c = i * 2 + 1; if (c + 1 < this.ids.length && this.priorities[c + 1] < this.priorities[c]) c++; if (priority <= this.priorities[c]) break; this.ids[i] = this.ids[c]; this.priorities[i] = this.priorities[c]; i = c }
      this.ids[i] = id; this.priorities[i] = priority
    }
    return result
  }
  get length(): number { return this.ids.length }
}

export class GridRouter {
  readonly layers: string[]
  readonly grid: GridProvider
  readonly outline: Point[]
  readonly obstacleIndex = new SpatialIndex<IndexedObstacle>()
  readonly copperIndex = new SpatialIndex<Copper>()
  readonly edgeIndex = new SpatialIndex<[Point, Point]>()
  readonly union = new UnionFind()
  readonly connections: Connection[]
  readonly config: RouterConfig
  readonly startTime = performance.now()
  readonly deadline: number
  readonly minI: number; readonly maxI: number; readonly minJ: number; readonly maxJ: number; readonly nx: number; readonly ny: number
  readonly xs: Float64Array; readonly ys: Float64Array; readonly inside: Uint8Array
  readonly dist: Float64Array; readonly prev: Int32Array; readonly seen: Uint32Array; readonly closed: Uint32Array; readonly legalSeen: Uint32Array; readonly legal: Uint8Array
  generation = 0
  traces: PcbTrace[] = []
  copper: Copper[] = []
  breakoutStats = { attemptedTerminals: 0, failedTerminals: 0, candidateCount: 0, totalExpandedStates: 0 }
  constructor(readonly input: Dataset, config: Partial<RouterConfig> = {}) {
    this.config = { ...defaultConfig, ...config }
    this.deadline = Date.now() + this.config.timeLimit * 1000
    const n = Math.max(2, input.layerCount ?? 2)
    this.layers = ["top", ...Array.from({ length: n - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
    this.grid = this.config.grid === "hex" ? createHexGrid(input.bounds, this.config.pitch) : createOctGrid(input.bounds, this.config.pitch)
    const corners = [[input.bounds.minX, input.bounds.minY], [input.bounds.minX, input.bounds.maxY], [input.bounds.maxX, input.bounds.minY], [input.bounds.maxX, input.bounds.maxY]].map(([x, y]) => this.grid.nearest(x, y))
    this.minI = Math.min(...corners.map(p => p[0])) - 2; this.maxI = Math.max(...corners.map(p => p[0])) + 2
    this.minJ = Math.min(...corners.map(p => p[1])) - 2; this.maxJ = Math.max(...corners.map(p => p[1])) + 2
    this.nx = this.maxI - this.minI + 1; this.ny = this.maxJ - this.minJ + 1
    const nodes = this.nx * this.ny, states = nodes * n
    if (states > 20_000_000) throw new Error(`Grid too large: ${states} layer states`)
    this.xs = new Float64Array(nodes); this.ys = new Float64Array(nodes); this.inside = new Uint8Array(nodes)
    this.dist = new Float64Array(states); this.prev = new Int32Array(states); this.seen = new Uint32Array(states); this.closed = new Uint32Array(states); this.legalSeen = new Uint32Array(states); this.legal = new Uint8Array(states)
    this.outline = input.outline?.length ? input.outline : [{ x: input.bounds.minX, y: input.bounds.minY }, { x: input.bounds.maxX, y: input.bounds.minY }, { x: input.bounds.maxX, y: input.bounds.maxY }, { x: input.bounds.minX, y: input.bounds.maxY }]
    for (let i = 0; i < this.outline.length; i++) { const edge: [Point, Point] = [this.outline[i], this.outline[(i + 1) % this.outline.length]]; this.edgeIndex.add(edge, segmentBounds(...edge, 0)) }
    for (let j = this.minJ; j <= this.maxJ; j++) for (let i = this.minI; i <= this.maxI; i++) {
      const node = this.node(i, j), p = this.grid.point(i, j)
      this.xs[node] = p.x; this.ys[node] = p.y; this.inside[node] = pointInPolygon(p, this.outline) ? 1 : 0
    }
    for (const o of input.obstacles) this.union.group(o.connectedTo ?? [])
    for (const c of input.connections) this.union.group([c.name, c.source_trace_id, ...c.pointsToConnect.flatMap(p => [p.pointId, p.pcb_port_id])].filter((v): v is string => !!v))
    // Connections that describe the same electrical net may legally touch the same pads.
    for (const [index, o] of input.obstacles.entries()) {
      const geometry = obstacleGeometry(o), activeLayers = new Set(o.layers.map(l => this.layers.indexOf(l)).filter(l => l >= 0))
      const ob: IndexedObstacle = { ...o, ...geometry, activeLayers, net: this.union.find(o.connectedTo?.[0] ?? `isolated-obstacle-${index}`) }
      const points = geometry.polygon ?? geometry.capsule!.slice(0, 2) as Point[], radius = geometry.capsule?.[2] ?? 0
      this.obstacleIndex.add(ob, { minX: Math.min(...points.map(p => p.x)) - radius, maxX: Math.max(...points.map(p => p.x)) + radius, minY: Math.min(...points.map(p => p.y)) - radius, maxY: Math.max(...points.map(p => p.y)) + radius })
    }
    this.connections = [...input.connections].sort((a, b) => this.span(a) - this.span(b) || a.name.localeCompare(b.name))
  }
  span(c: Connection): number { if (c.pointsToConnect.length < 2) return 0; const ps = c.pointsToConnect; return Math.hypot(Math.max(...ps.map(p => p.x)) - Math.min(...ps.map(p => p.x)), Math.max(...ps.map(p => p.y)) - Math.min(...ps.map(p => p.y))) }
  node(i: number, j: number): number { return (j - this.minJ) * this.nx + i - this.minI }
  point(id: number): Point { const n = Math.floor(id / this.layers.length); return { x: this.xs[n], y: this.ys[n] } }
  layer(id: number): number { return id % this.layers.length }
  state(i: number, j: number, layer: number): number { return this.node(i, j) * this.layers.length + layer }
  terminalLayers(p: Terminal, net: string): number[] {
    const layers = new Set((p.layers ?? [p.layer ?? "top"]).map(l => this.layers.indexOf(l)).filter(l => l >= 0))
    const declaredLayers = new Set(layers)
    // Only a containing pad that touches the declared terminal layer can provide
    // physical access to its other layers. Same-net opposite-side SMT pads do not.
    for (const o of this.obstacleIndex.query(segmentBounds(p, p, 0.01))) {
      if (o.net === net && segmentObstacleDistance(p, p, o) < EPS && [...declaredLayers].some(layer => o.activeLayers.has(layer))) {
        for (const layer of o.activeLayers) layers.add(layer)
      }
    }
    return [...layers].sort((a, b) => a - b)
  }
  segmentLegal(a: Point, b: Point, layer: number, radius: number, net: string): boolean {
    if (!pointInPolygon(a, this.outline) || !pointInPolygon(b, this.outline)) return false
    const margin = radius + this.config.clearance, bounds = segmentBounds(a, b, margin)
    for (const edge of this.edgeIndex.query(bounds)) if (segmentDistance(a, b, edge[0], edge[1]) < margin - EPS) return false
    for (const o of this.obstacleIndex.query(bounds)) if (o.net !== net && o.activeLayers.has(layer) && segmentObstacleDistance(a, b, o) < margin - EPS) return false
    for (const c of this.copperIndex.query(bounds)) if (c.net !== net && c.layers.includes(layer) && segmentDistance(a, b, c.a, c.b) < margin + c.radius - EPS) return false
    return true
  }
  viaLegal(p: Point, net: string): boolean { return this.layers.every((_, layer) => this.segmentLegal(p, p, layer, this.config.viaDiameter / 2, net)) }
  nodeLegal(id: number, radius: number, net: string): boolean {
    if (this.legalSeen[id] === this.generation) return !!this.legal[id]
    this.legalSeen[id] = this.generation
    const n = Math.floor(id / this.layers.length)
    this.legal[id] = this.inside[n] && this.segmentLegal(this.point(id), this.point(id), this.layer(id), radius, net) ? 1 : 0
    return !!this.legal[id]
  }
  breakouts(p: Terminal, net: string, width: number): Breakout[] {
    this.breakoutStats.attemptedTerminals++
    const [ci, cj] = this.grid.nearest(p.x, p.y), candidates: Breakout[] = [], layers = this.terminalLayers(p, net)
    // Search a local disk; several legal exits preserve a chance to escape crowded pad rows.
    const reach = Math.max(5, Math.ceil(1.6 / this.config.pitch))
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const i = ci + di, j = cj + dj
      if (i < this.minI || i > this.maxI || j < this.minJ || j > this.maxJ) continue
      const xy = this.grid.point(i, j), distance = Math.hypot(xy.x - p.x, xy.y - p.y)
      if (distance > 1.6 + this.config.pitch) continue
      for (const layer of layers) candidates.push({ id: this.state(i, j, layer), distance })
    }
    candidates.sort((a, b) => a.distance - b.distance || a.id - b.id)
    const valid: Breakout[] = []
    for (const c of candidates) {
      if (this.segmentLegal(p, this.point(c.id), this.layer(c.id), width / 2, net)) valid.push(c)
      if (valid.length >= this.config.breakoutCandidates * Math.max(1, layers.length)) break
    }
    this.breakoutStats.candidateCount += valid.length
    if (!valid.length) this.breakoutStats.failedTerminals++
    return valid
  }
  search(starts: Breakout[], goals: Breakout[], goalPoint: Point, width: number, net: string): RouteResult {
    if (!starts.length || !goals.length || Date.now() >= this.deadline) return null
    const generation = ++this.generation, heap = new MinHeap(), goalMap = new Map(goals.map(g => [g.id, g])), startMap = new Map(starts.map(g => [g.id, g]))
    const goalBounds = { minX: Math.min(...goals.map(g => this.point(g.id).x)), maxX: Math.max(...goals.map(g => this.point(g.id).x)), minY: Math.min(...goals.map(g => this.point(g.id).y)), maxY: Math.max(...goals.map(g => this.point(g.id).y)) }
    // Distance to a bounding box is an admissible lower bound for every possible goal.
    const heuristic = (id: number) => { const p = this.point(id); return Math.hypot(Math.max(goalBounds.minX - p.x, 0, p.x - goalBounds.maxX), Math.max(goalBounds.minY - p.y, 0, p.y - goalBounds.maxY)) }
    for (const start of starts) { this.seen[start.id] = generation; this.dist[start.id] = start.distance; this.prev[start.id] = -1; heap.push(start.id, start.distance + heuristic(start.id)) }
    let expanded = 0, bestGoal = -1, bestCost = Infinity
    while (heap.length) {
      const [id, priority] = heap.pop()
      if (priority >= bestCost - EPS) break
      if (this.closed[id] === generation) continue
      if (++expanded % 256 === 0 && Date.now() >= this.deadline) break
      this.closed[id] = generation
      const goal = goalMap.get(id)
      if (goal && this.dist[id] + goal.distance < bestCost) { bestGoal = id; bestCost = this.dist[id] + goal.distance }
      const layer = this.layer(id), node = Math.floor(id / this.layers.length), j = Math.floor(node / this.nx) + this.minJ, i = node % this.nx + this.minI, p = this.point(id)
      const relax = (next: number, cost: number) => { const nd = this.dist[id] + cost; if (this.closed[next] === generation || (this.seen[next] === generation && this.dist[next] <= nd + EPS)) return; this.seen[next] = generation; this.dist[next] = nd; this.prev[next] = id; heap.push(next, nd + heuristic(next)) }
      for (const [di, dj] of this.grid.directions) {
        const ni = i + di, nj = j + dj
        if (ni < this.minI || ni > this.maxI || nj < this.minJ || nj > this.maxJ) continue
        const next = this.state(ni, nj, layer)
        if (this.closed[next] === generation || !this.nodeLegal(next, width / 2, net)) continue
        const q = this.point(next), length = Math.hypot(q.x - p.x, q.y - p.y)
        if (this.seen[next] === generation && this.dist[next] <= this.dist[id] + length + EPS) continue
        // Exact capsule clearance rejects diagonal corner cuts in either lattice.
        if (this.segmentLegal(p, q, layer, width / 2, net)) relax(next, length)
      }
      if (this.viaLegal(p, net)) for (let nextLayer = 0; nextLayer < this.layers.length; nextLayer++) if (nextLayer !== layer) relax(node * this.layers.length + nextLayer, this.config.viaPenalty)
    }
    this.breakoutStats.totalExpandedStates += expanded
    if (bestGoal < 0) return null
    const ids: number[] = []; let id = bestGoal
    while (id >= 0) { ids.push(id); id = this.prev[id] }
    ids.reverse()
    return { ids, start: startMap.get(ids[0])!, end: goalMap.get(bestGoal), expanded }
  }
  addCopper(c: Copper): void { this.copper.push(c); this.copperIndex.add(c, segmentBounds(c.a, c.b, c.radius)) }
  commit(connection: Connection, result: NonNullable<RouteResult>, start: Terminal, target: Terminal | undefined, net: string, width: number): void {
    const route: TracePoint[] = [], nodes = result.ids
    const wire = (p: Point, layer: number): WirePoint => ({ route_type: "wire", x: p.x, y: p.y, width, layer: this.layers[layer] })
    route.push(wire(start, this.layer(nodes[0])))
    const first = this.point(nodes[0]); this.addCopper({ net, a: start, b: first, radius: width / 2, layers: [this.layer(nodes[0])] })
    route.push(wire(first, this.layer(nodes[0])))
    for (let k = 1; k < nodes.length; k++) {
      const previous = nodes[k - 1], id = nodes[k], a = this.point(previous), b = this.point(id), layer = this.layer(id)
      if (this.layer(previous) !== layer) {
        this.addCopper({ net, a: b, b, radius: this.config.viaDiameter / 2, layers: this.layers.map((_, l) => l) })
        route.push({ route_type: "via", x: b.x, y: b.y, from_layer: this.layers[this.layer(previous)], to_layer: this.layers[layer], outer_diameter: this.config.viaDiameter, hole_diameter: this.config.viaDiameter / 2 })
        route.push(wire(b, layer))
      } else { this.addCopper({ net, a, b, radius: width / 2, layers: [layer] }); route.push(wire(b, layer)) }
    }
    if (target) { const last = this.point(nodes[nodes.length - 1]), layer = this.layer(nodes[nodes.length - 1]); this.addCopper({ net, a: last, b: target, radius: width / 2, layers: [layer] }); route.push(wire(target, layer)) }
    // Remove repeated points and only genuinely collinear intermediate wire vertices.
    const simplified: TracePoint[] = []
    for (const p of route) {
      const b = simplified.at(-1), a = simplified.at(-2)
      if (b?.route_type === "wire" && p.route_type === "wire" && b.layer === p.layer && Math.hypot(b.x - p.x, b.y - p.y) < EPS) continue
      if (a?.route_type === "wire" && b?.route_type === "wire" && p.route_type === "wire" && a.layer === b.layer && b.layer === p.layer && Math.abs(cross(a, b, p)) < EPS && (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= -EPS) simplified.pop()
      simplified.push(p)
    }
    this.traces.push({ type: "pcb_trace", pcb_trace_id: `experimental_${this.grid.kind}_${this.traces.length}`, source_trace_id: connection.source_trace_id ?? connection.name, connection_name: connection.name, route: simplified })
  }
  run(): RouterOutput {
    const completed: string[] = [], failed: FailedConnection[] = [], noRouteRequired: string[] = []
    for (let ci = 0; ci < this.connections.length; ci++) {
      const connection = this.connections[ci], points = connection.pointsToConnect, net = this.union.find(connection.name), width = connection.width ?? connection.nominalTraceWidth ?? this.input.minTraceWidth ?? 0.1
      if (points.length < 2) { noRouteRequired.push(connection.name); continue }
      if (Date.now() >= this.deadline) { failed.push({ name: connection.name, reason: "time_limit", connectedTerminalCount: 0 }); continue }
      const breakouts = points.map(p => this.breakouts(p, net, width)), remaining = new Set(points.map((_, i) => i)), tree = new Set<number>()
      let first = 0, second = 1, closest = Infinity
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) { const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y); if (distance < closest) { closest = distance; first = i; second = j } }
      const initial = this.search(breakouts[first], breakouts[second], points[second], width, net)
      if (!initial) { failed.push({ name: connection.name, reason: Date.now() >= this.deadline ? "time_limit" : !breakouts[first].length || !breakouts[second].length ? "no_legal_breakout" : "no_path", connectedTerminalCount: 0 }); continue }
      this.commit(connection, initial, points[first], points[second], net, width); for (const id of initial.ids) tree.add(id); remaining.delete(first); remaining.delete(second)
      while (remaining.size && Date.now() < this.deadline) {
        let nearestTerminal = -1, nearestDistance = Infinity
        for (const index of remaining) for (const id of tree) { const p = this.point(id), distance = Math.hypot(points[index].x - p.x, points[index].y - p.y); if (distance < nearestDistance) { nearestDistance = distance; nearestTerminal = index } }
        if (nearestTerminal < 0) break
        // The target candidates are existing, physically connected tree vertices.
        const goals = [...tree].map(id => ({ id, distance: 0, proximity: Math.hypot(points[nearestTerminal].x - this.point(id).x, points[nearestTerminal].y - this.point(id).y) })).sort((a, b) => a.proximity - b.proximity || a.id - b.id).slice(0, 32)
        const branch = this.search(breakouts[nearestTerminal], goals, this.point(goals[0].id), width, net)
        if (!branch) break
        this.commit(connection, branch, points[nearestTerminal], undefined, net, width); for (const id of branch.ids) tree.add(id); remaining.delete(nearestTerminal)
      }
      if (!remaining.size) completed.push(connection.name)
      else failed.push({ name: connection.name, reason: Date.now() >= this.deadline ? "time_limit" : "unconnected_branch", connectedTerminalCount: points.length - remaining.size })
    }
    return { ...this.input, traces: this.traces, experiment: { elapsedMs: performance.now() - this.startTime, completedConnectionNames: completed, failedConnections: failed, noRouteRequiredConnectionNames: noRouteRequired, status: failed.length ? Date.now() >= this.deadline ? "time_limit" : "partial" : "completed", config: this.config, layerNames: this.layers, breakoutStats: this.breakoutStats, gridNodeCount: this.xs.length, gridStateCount: this.dist.length, algorithm: "legal terminal fanouts, nearest unconnected terminal to physical tree, finite-width A* with Euclidean length and via penalty; no rip-up" } }
  }
}
export function routeDataset(input: Dataset, config: Partial<RouterConfig> = {}): RouterOutput { return new GridRouter(input, config).run() }

if (import.meta.main) {
  const args = process.argv.slice(2), file = args[0]
  const value = (flag: string, fallback?: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : fallback }
  if (!file || file.startsWith("--")) throw new Error("Usage: bun src/gridRouter.ts INPUT.json --grid hex|oct --pitch 0.2 --clearance 0.1 --time-limit 60 --out OUTPUT.json")
  const config: RouterConfig = { ...defaultConfig, grid: value("--grid", "hex") as "hex" | "oct", pitch: Number(value("--pitch", "0.2")), clearance: Number(value("--clearance", "0.1")), timeLimit: Number(value("--time-limit", "60")), viaDiameter: Number(value("--via-diameter", "0.3")), viaPenalty: Number(value("--via-penalty", "2")), breakoutCandidates: Number(value("--breakout-candidates", "16")) }
  if (!["hex", "oct"].includes(config.grid) || config.pitch <= 0 || config.clearance < 0 || config.timeLimit <= 0 || config.viaDiameter <= 0 || config.viaPenalty < 0) throw new Error("Invalid routing configuration")
  const input = JSON.parse(readFileSync(file, "utf8")), output = routeDataset(input, config), path = value("--out", `${file}.${config.grid}.routed.json`)!
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(output, null, 2))
  console.log(JSON.stringify({ output: path, ...output.experiment, failedConnections: output.experiment.failedConnections.length, completedConnectionNames: output.experiment.completedConnectionNames.length, noRouteRequiredConnectionNames: output.experiment.noRouteRequiredConnectionNames.length }))
}
