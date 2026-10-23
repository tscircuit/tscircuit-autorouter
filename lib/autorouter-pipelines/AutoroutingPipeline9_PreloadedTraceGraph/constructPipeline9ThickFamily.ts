import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { doPipeline9RoutesHaveCopperConflict } from "./pipeline9FixedRouteCopper"

type Point = { x: number; y: number }
type Rect = { minX: number; maxX: number; minY: number; maxY: number }
type Endpoint = { original: PortPoint; core: Point; t: number }
type Pair = { a: Endpoint; b: Endpoint }
export const thickFamilyStatKeys = [
  "thickFamilyAttemptedCells", "thickFamilyEligibleCells", "thickFamilySolvedCells",
  "thickFamilyUnsupportedPairingCells", "thickFamilyUnsupportedLayerCells",
  "thickFamilyUnsupportedBoundaryCells", "thickFamilyPhysicalDomainRejectedCells",
  "thickFamilyMetricRejectedCells", "thickFamilyClearanceRejectedCells",
  "thickFamilyDepthIntervals", "thickFamilyReservedRectangles", "thickFamilyVisibilityNodes",
  "thickFamilyVisibilityPredicates", "thickFamilySearchRelaxations", "thickFamilyPairPredicates",
  "thickFamilyScenePortPredicates", "thickFamilySceneRoutePredicates", "thickFamilyConstructedRoutes",
] as const
export type ThickFamilyStats = Record<(typeof thickFamilyStatKeys)[number], number>
export type ThickFamilyResult = { applicable: boolean; routes: HighDensityIntraNodeRoute[]; stats: ThickFamilyStats }
type Params = {
  node: NodeWithPortPoints; traceWidth: number; clearance: number; viaDiameter: number
  obstacles: Obstacle[]; boardGeometry?: HighDensityBoardGeometry; layerCount: number
  scenePorts: readonly PortPoint[]; sceneRoutes: readonly HighDensityIntraNodeRoute[]
}
const EPS = 1e-7

/** Fixed inward normal leads form the interface contract; coordinates never move. */
function prepareEndpoint(port: PortPoint, box: Rect, inset: number): Endpoint | null {
  const width = box.maxX - box.minX, height = box.maxY - box.minY
  const sides = [Math.abs(port.y - box.minY), Math.abs(port.x - box.maxX), Math.abs(port.y - box.maxY), Math.abs(port.x - box.minX)]
  if (sides.filter((d) => d < EPS).length !== 1) return null
  const side = sides.findIndex((d) => d < EPS)
  if ((side === 0 || side === 2) && (port.x <= box.minX + inset || port.x >= box.maxX - inset)) return null
  if ((side === 1 || side === 3) && (port.y <= box.minY + inset || port.y >= box.maxY - inset)) return null
  const core = { x: port.x, y: port.y }
  let t: number
  if (side === 0) { core.y += inset; t = core.x - box.minX - inset }
  else if (side === 1) { core.x -= inset; t = width - 2 * inset + core.y - box.minY - inset }
  else if (side === 2) { core.y -= inset; t = width - 2 * inset + height - 2 * inset + box.maxX - inset - core.x }
  else { core.x += inset; t = 2 * (width - 2 * inset) + height - 2 * inset + box.maxY - inset - core.y }
  return { original: port, core, t }
}

/** True if the open segment enters the open rectangle; tangency is legal. */
function segmentEntersRectangle(a: Point, b: Point, rect: Rect): boolean {
  let low = 0, high = 1
  for (const axis of ["x", "y"] as const) {
    const min = axis === "x" ? rect.minX : rect.minY, max = axis === "x" ? rect.maxX : rect.maxY
    const delta = b[axis] - a[axis]
    if (Math.abs(delta) < EPS) {
      if (a[axis] <= min + EPS || a[axis] >= max - EPS) return false
      continue
    }
    const t1 = (min + EPS - a[axis]) / delta, t2 = (max - EPS - a[axis]) / delta
    low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2))
    if (high <= low) return false
  }
  return high > low && high > 0 && low < 1
}

/** Visibility shortest path in the union of reserved boundary strips. */
function shortestPath(a: Point, b: Point, core: Rect, rectangles: Rect[], stats: ThickFamilyStats): Point[] | null {
  const vertices: Point[] = [a, b]
  const seen = new Set([`${a.x},${a.y}`, `${b.x},${b.y}`])
  for (const rect of rectangles) {
    for (const x of [rect.minX, rect.maxX]) for (const y of [rect.minY, rect.maxY]) {
      const key = `${x},${y}`
      if (seen.has(key) || x < core.minX - EPS || x > core.maxX + EPS || y < core.minY - EPS || y > core.maxY + EPS) continue
      if (rectangles.some((r) => x > r.minX + EPS && x < r.maxX - EPS && y > r.minY + EPS && y < r.maxY - EPS)) continue
      vertices.push({ x, y }); seen.add(key)
    }
  }
  if ([a, b].some((p) => rectangles.some((r) => p.x > r.minX + EPS && p.x < r.maxX - EPS && p.y > r.minY + EPS && p.y < r.maxY - EPS))) return null
  stats.thickFamilyVisibilityNodes += vertices.length
  const distances = vertices.map(() => Infinity), previous = vertices.map(() => -1), closed = vertices.map(() => false)
  distances[0] = 0
  for (let iteration = 0; iteration < vertices.length; iteration++) {
    let current = -1
    for (let i = 0; i < vertices.length; i++) if (!closed[i] && (current < 0 || distances[i]! < distances[current]!)) current = i
    if (current < 0 || distances[current] === Infinity) return null
    if (current === 1) {
      const result: Point[] = []
      for (let i = 1; i >= 0; i = previous[i]!) result.push(vertices[i]!)
      return result.reverse()
    }
    closed[current] = true
    for (let next = 0; next < vertices.length; next++) {
      if (closed[next]) continue
      const from = vertices[current]!, to = vertices[next]!
      let visible = true
      for (const rectangle of rectangles) {
        stats.thickFamilyVisibilityPredicates++
        if (segmentEntersRectangle(from, to, rectangle)) { visible = false; break }
      }
      if (!visible) continue
      stats.thickFamilySearchRelaxations++
      const cost = distances[current]! + Math.hypot(from.x - to.x, from.y - to.y)
      if (cost < distances[next]!) { distances[next] = cost; previous[next] = current }
    }
  }
  return null
}

/** A disk encloses rotated rectangular and circular obstacles conservatively. */
function physicalDomainIsClear(params: Params, box: Rect, z: number): boolean {
  const reach = params.traceWidth / 2 + params.clearance + 1e-6
  for (const obstacle of params.obstacles) {
    const layers = obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.map((name) => mapLayerNameToZ(name, params.layerCount))
    if (!layers.includes(z)) continue
    const radius = Math.hypot(obstacle.width / 2, obstacle.height / 2) + reach
    const dx = Math.max(box.minX - obstacle.center.x, 0, obstacle.center.x - box.maxX)
    const dy = Math.max(box.minY - obstacle.center.y, 0, obstacle.center.y - box.maxY)
    if (dx * dx + dy * dy <= radius * radius) return false
  }
  const board = params.boardGeometry
  if (!board) return true
  const polygon = board.outline && board.outline.length >= 3 ? board.outline : [
    { x: board.bounds.minX, y: board.bounds.minY }, { x: board.bounds.maxX, y: board.bounds.minY },
    { x: board.bounds.maxX, y: board.bounds.maxY }, { x: board.bounds.minX, y: board.bounds.maxY },
  ]
  const corners = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]
  if (corners.some((p) => !isPointInOrOnPolygon(p, polygon))) return false
  const boardReach = params.traceWidth / 2 + (board.minBoardEdgeClearance ?? 0.15) + 1e-6
  for (let i = 0; i < polygon.length; i++) for (let j = 0; j < 4; j++) {
    if (minimumDistanceBetweenSegments(polygon[i]!, polygon[(i + 1) % polygon.length]!, corners[j]!, corners[(j + 1) % 4]!) < boardReach) return false
  }
  return true
}

/**
 * Collective chord-depth construction, inspired by Mitchell/Polishchuk (2007).
 * Every other strand reserves a boundary arc before ANY wire is routed.
 * C-infinity offsets are conservative; independent Euclidean copper validation
 * determines the accepted metric domain. No finite route formulas are searched.
 */
export function constructPipeline9ThickFamily(params: Params): ThickFamilyResult {
  const stats = Object.fromEntries(thickFamilyStatKeys.map((key) => [key, 0])) as ThickFamilyStats
  stats.thickFamilyAttemptedCells = 1
  const reject = (key: keyof ThickFamilyStats): ThickFamilyResult => {
    stats[key]++
    return {
      applicable: false,
      routes: [],
      stats,
    }
  }
  const { node, traceWidth, clearance } = params
  if (![node.width, node.height, traceWidth, clearance, params.viaDiameter, node.center.x, node.center.y].every(Number.isFinite) || node.width <= 0 || node.height <= 0 || traceWidth <= 0 || clearance < 0) throw new Error("Thick-family invalid dimensions")
  const groups = new Map<string, PortPoint[]>()
  for (const port of node.portPoints) {
    if (![port.x, port.y, port.z].every(Number.isFinite)) throw new Error("Thick-family nonfinite port")
    const ports = groups.get(port.connectionName) ?? []
    ports.push(port); groups.set(port.connectionName, ports)
  }
  if (groups.size < 2 || [...groups.values()].some((ports) => ports.length !== 2)) return reject("thickFamilyUnsupportedPairingCells")
  const z = node.portPoints[0]!.z
  if (node.portPoints.some((port) => port.z !== z)) return reject("thickFamilyUnsupportedLayerCells")
  const box = { minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2, minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 }
  const inset = traceWidth / 2 + clearance + 1e-6, pitch = traceWidth + clearance + 2e-6
  if (node.width <= 2 * inset || node.height <= 2 * inset) return reject("thickFamilyUnsupportedBoundaryCells")
  const core = { minX: box.minX + inset, maxX: box.maxX - inset, minY: box.minY + inset, maxY: box.maxY - inset }
  const width = core.maxX - core.minX, height = core.maxY - core.minY, perimeter = 2 * (width + height)
  const pairs: Pair[] = []
  for (const ports of groups.values()) {
    const a = prepareEndpoint(ports[0]!, box, inset), b = prepareEndpoint(ports[1]!, box, inset)
    if (!a || !b) return reject("thickFamilyUnsupportedBoundaryCells")
    pairs.push({ a, b })
  }
  const between = (t: number, a: number, b: number): boolean => {
    if (a < b) {
      return t > a + EPS && t < b - EPS
    }
    // A wrapping arc crosses the origin of the perimeter coordinate.
    return t > a + EPS || t < b - EPS
  }
  for (let i = 0; i < pairs.length; i++) for (let j = 0; j < i; j++) {
    const a = pairs[i]!, b = pairs[j]!
    if (between(a.a.t, b.a.t, b.b.t) !== between(a.b.t, b.a.t, b.b.t)) return reject("thickFamilyUnsupportedPairingCells")
  }
  const endpoints = pairs.flatMap((p) => [p.a, p.b]).sort((a, b) => a.t - b.t)
  for (let i = 1; i < endpoints.length; i++) if (endpoints[i]!.t - endpoints[i - 1]!.t < EPS) return reject("thickFamilyUnsupportedBoundaryCells")
  if (!physicalDomainIsClear(params, box, z)) return reject("thickFamilyPhysicalDomainRejectedCells")
  stats.thickFamilyEligibleCells = 1
  const cuts = [...new Set([0, width, width + height, 2 * width + height, perimeter, ...endpoints.map((e) => e.t)])].sort((a, b) => a - b)
  const routes: HighDensityIntraNodeRoute[] = []
  for (const pair of pairs) {
    const rectangles: Rect[] = []
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1]!, hi = cuts[i]!, mid = (lo + hi) / 2
      let depth = 0
      for (const other of pairs) {
        if (other === pair) continue
        if (between(mid, other.a.t, other.b.t) !== between(pair.a.t, other.a.t, other.b.t)) depth++
      }
      stats.thickFamilyDepthIntervals++
      if (depth === 0) continue
      const d = depth * pitch
      let rect: Rect
      if (mid < width) rect = { minX: core.minX + lo - d, maxX: core.minX + hi + d, minY: core.minY - d, maxY: core.minY + d }
      else if (mid < width + height) rect = { minX: core.maxX - d, maxX: core.maxX + d, minY: core.minY + lo - width - d, maxY: core.minY + hi - width + d }
      else if (mid < 2 * width + height) rect = { minX: core.maxX - (hi - width - height) - d, maxX: core.maxX - (lo - width - height) + d, minY: core.maxY - d, maxY: core.maxY + d }
      else rect = { minX: core.minX - d, maxX: core.minX + d, minY: core.maxY - (hi - 2 * width - height) - d, maxY: core.maxY - (lo - 2 * width - height) + d }
      rectangles.push(rect)
    }
    stats.thickFamilyReservedRectangles += rectangles.length
    const path = shortestPath(pair.a.core, pair.b.core, core, rectangles, stats)
    if (!path) return reject("thickFamilyMetricRejectedCells")
    const route = [pair.a.original, ...path.map((p) => ({ ...p, z })), pair.b.original].map((p) => ({ x: p.x, y: p.y, z }))
    routes.push({ connectionName: pair.a.original.connectionName, rootConnectionName: pair.a.original.rootConnectionName, traceThickness: traceWidth, viaDiameter: params.viaDiameter, route, vias: [], regionId: node.capacityMeshNodeId })
  }
  // Independent physical validation, separate from the depth construction.
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]!
    for (let j = 0; j < i; j++) {
      const other = routes[j]!
      if ((route.rootConnectionName ?? route.connectionName) === (other.rootConnectionName ?? other.connectionName)) continue
      for (let a = 1; a < route.route.length; a++) for (let b = 1; b < other.route.length; b++) {
        stats.thickFamilyPairPredicates++
        if (minimumDistanceBetweenSegments(route.route[a - 1]!, route.route[a]!, other.route[b - 1]!, other.route[b]!) < traceWidth + clearance + 1e-6) return reject("thickFamilyClearanceRejectedCells")
      }
    }
    for (const port of params.scenePorts) {
      if (port.z !== z || (port.rootConnectionName ?? port.connectionName) === (route.rootConnectionName ?? route.connectionName)) continue
      for (let a = 1; a < route.route.length; a++) {
        stats.thickFamilyScenePortPredicates++
        if (pointToSegmentDistance(port, route.route[a - 1]!, route.route[a]!) < traceWidth + clearance + 1e-6) return reject("thickFamilyClearanceRejectedCells")
      }
    }
    for (const other of params.sceneRoutes) {
      if ((route.rootConnectionName ?? route.connectionName) === (other.rootConnectionName ?? other.connectionName)) continue
      stats.thickFamilySceneRoutePredicates++
      if (doPipeline9RoutesHaveCopperConflict({ left: route, right: other, clearance: clearance + 1e-6, layerCount: params.layerCount })) return reject("thickFamilyClearanceRejectedCells")
    }
  }
  stats.thickFamilySolvedCells = 1; stats.thickFamilyConstructedRoutes = routes.length
  return { applicable: true, routes, stats }
}
