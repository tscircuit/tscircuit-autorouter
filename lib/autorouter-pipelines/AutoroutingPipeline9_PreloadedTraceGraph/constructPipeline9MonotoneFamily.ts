import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getCanonicalPipeline9PortRoot } from "./getCanonicalPipeline9PortRoot"
import { isPipeline9ObstacleOwnedByRoute } from "./isPipeline9ObstacleOwnedByRoute"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { doPipeline9RoutesHaveCopperConflict, getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { compileMonotoneLaneTemplate, type MonotoneLaneTemplateCache } from "./compileMonotoneLaneTemplate"

type Point = { x: number; y: number; z: number }
type Rect = { minX: number; maxX: number; minY: number; maxY: number }
type Endpoint = { port: PortPoint; core: Point; side: number }
type Pair = { a: Endpoint; b: Endpoint; reversed: boolean }
export const monotoneFamilyStatKeys = [
  "monotoneFamilyAttemptedCells", "monotoneFamilyEligibleCells", "monotoneFamilySolvedCells",
  "monotoneFamilyUnsupportedPairingCells", "monotoneFamilyUnsupportedBoundaryCells", "monotoneFamilyUnsupportedOrderCells",
  "monotoneFamilyPhysicalDomainRejectedCells", "monotoneFamilyMetricRejectedCells", "monotoneFamilyClearanceRejectedCells",
  "monotoneFamilyConstructedRoutes", "monotoneFamilyConstructedVias", "monotoneFamilySinglePairCells", "monotoneFamilyCollectiveCells",
  "monotoneFamilyPairPredicates", "monotoneFamilyScenePortPredicates", "monotoneFamilySceneRoutePredicates", "monotoneFamilyOverhangingPorts",
  "monotoneFamilyDrillPredicates", "monotoneFamilyUnsupportedDrillRuleCells", "monotoneFamilyUnsupportedDrillSceneCells", "monotoneFamilyDrillPitchActiveCells", "monotoneFamilyOwnedWireExemptions",
  "monotoneFamilyObstaclePredicates", "monotoneFamilyBoardPredicates",
  "monotoneFamilyTemplateAttempts", "monotoneFamilyTemplateCacheHits", "monotoneFamilyTemplateDomainPredicates",
  "monotoneFamilyTemplateDomainRejections", "monotoneFamilyAffineLaneInstantiations", "monotoneFamilyContinuousSolves",
  "monotoneFamilyActiveBlockMerges", "monotoneFamilyCompiledTemplates", "monotoneFamilyCompiledActiveBlocks",
] as const
type Result = { applicable: boolean; routes: HighDensityIntraNodeRoute[]; stats: Record<string, number> }
type Params = {
  node: NodeWithPortPoints; traceWidth: number; clearance: number; viaDiameter: number
  obstacles: Obstacle[]; boardGeometry?: HighDensityBoardGeometry; layerCount: number
  allowBlindAndBuriedVias?: boolean; viaToPadClearance?: number; traceToPadClearance?: number; traceToHoleClearance?: number
  viaHoleDiameter?: number; viaHoleClearance?: number; unsupportedDrillScene?: boolean; connMap?: ConnectivityMap
  scenePorts: readonly PortPoint[]; sceneRoutes: readonly HighDensityIntraNodeRoute[]
  cache: MonotoneLaneTemplateCache
}
const EPS = 1e-7

/** Actual endpoints are retained, including small mesh-port overhang. The only
 * outside-core geometry is the fixed inward normal lead with its true start. */
function prepareEndpoint(port: PortPoint, box: Rect, inset: number): Endpoint | null {
  const distances = [Math.abs(port.y - box.minY), Math.abs(port.x - box.maxX), Math.abs(port.y - box.maxY), Math.abs(port.x - box.minX)]
  const side = distances.indexOf(Math.min(...distances))
  if (distances[side]! > inset / 2) return null
  const core = { x: port.x, y: port.y, z: port.z }
  if (side === 0) core.y = box.minY + inset
  else if (side === 1) core.x = box.maxX - inset
  else if (side === 2) core.y = box.maxY - inset
  else core.x = box.minX + inset
  if (core.x < box.minX + inset - EPS || core.x > box.maxX - inset + EPS || core.y < box.minY + inset - EPS || core.y > box.maxY - inset + EPS) return null
  return { port, core, side }
}

/** Exact local obstacle geometry, including rotated rectangles and circles. */
function distanceToObstacle(start: Point, end: Point, obstacle: Obstacle): number {
  const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  const ax = start.x - obstacle.center.x, ay = start.y - obstacle.center.y
  const bx = end.x - obstacle.center.x, by = end.y - obstacle.center.y
  const a = { x: cosine * ax - sine * ay, y: sine * ax + cosine * ay }
  const b = { x: cosine * bx - sine * by, y: sine * bx + cosine * by }
  if (obstacle.shape === "circle") return Math.max(0, pointToSegmentDistance({ x: 0, y: 0 }, a, b) - Math.max(obstacle.width, obstacle.height) / 2)
  const hx = obstacle.width / 2, hy = obstacle.height / 2
  if ([a, b].some((p) => Math.abs(p.x) <= hx && Math.abs(p.y) <= hy)) return 0
  const corners = [{ x: -hx, y: -hy }, { x: hx, y: -hy }, { x: hx, y: hy }, { x: -hx, y: hy }]
  let distance = Infinity
  for (let i = 0; i < 4; i++) distance = Math.min(distance, minimumDistanceBetweenSegments(a, b, corners[i]!, corners[(i + 1) % 4]!))
  return distance
}

/** Independent physical certificate for the instantiated copper, rather than
 * a whole-cell obstacle-free assumption. Registered same-net wire contact is
 * allowed; all vias and nonplated holes retain their physical exclusions. */
function routeMeetsPhysicalDomain(route: HighDensityIntraNodeRoute, params: Params, stats: Record<string, number>): boolean {
  const geometry = getPipeline9RouteCopperGeometry(route, { layerCount: params.layerCount, allowBlindAndBuriedVias: params.allowBlindAndBuriedVias })
  const board = params.boardGeometry
  const polygon = !board ? undefined : board.outline && board.outline.length >= 3 ? board.outline : [
    { x: board.bounds.minX, y: board.bounds.minY }, { x: board.bounds.maxX, y: board.bounds.minY },
    { x: board.bounds.maxX, y: board.bounds.maxY }, { x: board.bounds.minX, y: board.bounds.maxY },
  ]
  const primitives = [
    ...geometry.wireSegments.map((segment) => ({ start: segment.start, end: segment.end, radius: segment.width / 2, minZ: segment.z, maxZ: segment.z, via: false })),
    ...geometry.viaSpans.map((via) => ({ start: { ...via.center, z: via.minZ }, end: { ...via.center, z: via.maxZ }, radius: via.diameter / 2, minZ: via.minZ, maxZ: via.maxZ, via: true })),
  ]
  for (const primitive of primitives) {
    if (polygon) {
      stats.monotoneFamilyBoardPredicates += 2
      if (!isPointInOrOnPolygon(primitive.start, polygon) || !isPointInOrOnPolygon(primitive.end, polygon)) return false
      for (let i = 0; i < polygon.length; i++) {
        stats.monotoneFamilyBoardPredicates++
        if (minimumDistanceBetweenSegments(primitive.start, primitive.end, polygon[i]!, polygon[(i + 1) % polygon.length]!) < primitive.radius + (board!.minBoardEdgeClearance ?? 0.15) + 1e-6) return false
      }
    }
    for (const obstacle of params.obstacles) {
      if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) || obstacle.width < 0 || obstacle.height < 0) throw new Error("Monotone family has invalid obstacle geometry")
      const layers = obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, params.layerCount))
      if (!layers.some((z) => z >= primitive.minZ && z <= primitive.maxZ)) continue
      if (!primitive.via && !obstacle.isNonPlatedHole && params.connMap && isPipeline9ObstacleOwnedByRoute(obstacle, route, params.connMap)) { stats.monotoneFamilyOwnedWireExemptions++; continue }
      stats.monotoneFamilyObstaclePredicates++
      const gap = Math.max(params.clearance, primitive.via ? params.viaToPadClearance ?? 0 : obstacle.isNonPlatedHole ? params.traceToHoleClearance ?? 0 : params.traceToPadClearance ?? 0)
      // Treat an obstacle's entire footprint as a possible existing drill. This
      // is conservative when imported obstacle metadata omits its hole size.
      const required = primitive.via ? Math.max(primitive.radius + gap, params.viaHoleDiameter! / 2 + params.viaHoleClearance!) : primitive.radius + gap
      if (distanceToObstacle(primitive.start, primitive.end, obstacle) < required + 1e-6) return false
    }
  }
  return true
}

/** A continuous family is compiled into active-set affine templates. It does
 * not enumerate elbows, chords or fixed via-site candidates. Metric predicates
 * independently certify the instantiated family before native dispatch ends. */
export function constructPipeline9MonotoneFamily(params: Params): Result {
  const stats = Object.fromEntries(monotoneFamilyStatKeys.map((key) => [key, 0])) as Record<string, number>
  stats.monotoneFamilyAttemptedCells = 1
  const reject = (reason: string): Result => {
    stats[reason]++
    return {
      applicable: false,
      routes: [],
      stats,
    }
  }
  const { node, traceWidth, clearance, viaDiameter } = params
  if (![node.width, node.height, node.center.x, node.center.y, traceWidth, clearance, viaDiameter].every(Number.isFinite) || node.width <= 0 || node.height <= 0 || traceWidth <= 0 || viaDiameter <= 0 || clearance < 0) throw new Error("Monotone family has invalid dimensions")
  const groups = new Map<string, PortPoint[]>()
  for (const port of node.portPoints) {
    if (![port.x, port.y, port.z].every(Number.isFinite)) throw new Error("Monotone family has nonfinite port")
    const group = groups.get(port.connectionName) ?? []
    group.push(port); groups.set(port.connectionName, group)
  }
  if (groups.size === 0 || [...groups.values()].some((group) => group.length !== 2)) return reject("monotoneFamilyUnsupportedPairingCells")
  const hasVia = [...groups.values()].some(([a, b]) => a!.z !== b!.z)
  if (hasVia && (params.viaHoleDiameter === undefined || params.viaHoleClearance === undefined)) return reject("monotoneFamilyUnsupportedDrillRuleCells")
  if (hasVia && (!Number.isFinite(params.viaHoleDiameter) || params.viaHoleDiameter! <= 0 || params.viaHoleDiameter! > viaDiameter || !Number.isFinite(params.viaHoleClearance) || params.viaHoleClearance! < 0)) throw new Error("Monotone family has invalid actual drill rules")
  if (hasVia && params.unsupportedDrillScene) return reject("monotoneFamilyUnsupportedDrillSceneCells")
  const inset = traceWidth / 2 + clearance + 1e-6
  const viaInset = Math.max(viaDiameter, traceWidth) / 2 + clearance + 1e-6
  const box = { minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2, minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 }
  if (node.width <= 2 * inset || node.height <= 2 * inset) return reject("monotoneFamilyUnsupportedBoundaryCells")
  const pairs: Pair[] = []
  for (const [a, b] of groups.values()) {
    const first = prepareEndpoint(a!, box, inset), second = prepareEndpoint(b!, box, inset)
    if (!first || !second) return reject("monotoneFamilyUnsupportedBoundaryCells")
    pairs.push({ a: first, b: second, reversed: false })
  }
  for (const port of node.portPoints) if (port.x < box.minX - EPS || port.x > box.maxX + EPS || port.y < box.minY - EPS || port.y > box.maxY + EPS) stats.monotoneFamilyOverhangingPorts++
  const routes: HighDensityIntraNodeRoute[] = []
  if (pairs.length === 1) {
    const pair = pairs[0]!
    const siteInset = hasVia ? viaInset : inset
    if (node.width <= 2 * siteInset || node.height <= 2 * siteInset) return reject("monotoneFamilyMetricRejectedCells")
    const xs = compileMonotoneLaneTemplate({ key: JSON.stringify(["single-x", pair.a.core.z, pair.b.core.z]), targets: [(pair.a.core.x + pair.b.core.x) / 2], separation: 0, lower: box.minX + siteInset, upper: box.maxX - siteInset, cache: params.cache, stats })
    const ys = compileMonotoneLaneTemplate({ key: JSON.stringify(["single-y", pair.a.core.z, pair.b.core.z]), targets: [(pair.a.core.y + pair.b.core.y) / 2], separation: 0, lower: box.minY + siteInset, upper: box.maxY - siteInset, cache: params.cache, stats })
    const site = { x: xs[0]!, y: ys[0]! }
    const points: Point[] = [pair.a.port, pair.a.core, { ...site, z: pair.a.core.z }]
    const vias: Array<{ x: number; y: number }> = []
    if (pair.a.core.z !== pair.b.core.z) { points.push({ ...site, z: pair.b.core.z }); vias.push(site) }
    points.push(pair.b.core, pair.b.port)
    routes.push({ connectionName: pair.a.port.connectionName, rootConnectionName: pair.a.port.rootConnectionName, traceThickness: traceWidth, viaDiameter, route: points.map((p) => ({ x: p.x, y: p.y, z: p.z })), vias, regionId: node.capacityMeshNodeId })
    stats.monotoneFamilySinglePairCells = 1
  } else {
    const horizontal = pairs.every((pair) => (pair.a.side === 3 && pair.b.side === 1) || (pair.a.side === 1 && pair.b.side === 3))
    const vertical = pairs.every((pair) => (pair.a.side === 0 && pair.b.side === 2) || (pair.a.side === 2 && pair.b.side === 0))
    if (!horizontal && !vertical) return reject("monotoneFamilyUnsupportedBoundaryCells")
    for (const pair of pairs) if ((horizontal ? pair.a.core.x > pair.b.core.x : pair.a.core.y > pair.b.core.y)) {
      const original = pair.a; pair.a = pair.b; pair.b = original; pair.reversed = true
    }
    pairs.sort((a, b) => horizontal ? a.a.core.y - b.a.core.y : a.a.core.x - b.a.core.x)
    for (let i = 1; i < pairs.length; i++) if ((horizontal ? pairs[i]!.b.core.y - pairs[i - 1]!.b.core.y : pairs[i]!.b.core.x - pairs[i - 1]!.b.core.x) <= EPS) return reject("monotoneFamilyUnsupportedOrderCells")
    const minimumU = horizontal ? box.minX + inset : box.minY + inset, maximumU = horizontal ? box.maxX - inset : box.maxY - inset
    const laneInset = hasVia ? viaInset : inset
    const minimumV = horizontal ? box.minY + laneInset : box.minX + laneInset, maximumV = horizontal ? box.maxY - laneInset : box.maxX - laneInset
    const annulusPitch = (hasVia ? Math.max(viaDiameter, traceWidth) : traceWidth) + clearance
    const holePitch = hasVia ? params.viaHoleDiameter! + params.viaHoleClearance! : 0
    const spacingRule = holePitch > annulusPitch ? "drill" : "copper"
    const separation = Math.max(annulusPitch, holePitch) + 2e-6
    if (spacingRule === "drill") stats.monotoneFamilyDrillPitchActiveCells++
    const upper = maximumV - (pairs.length - 1) * separation
    const halfSlab = Math.max((hasVia ? viaDiameter / 2 : traceWidth / 2) + traceWidth / 2 + clearance + 1e-6, (maximumU - minimumU) / 6)
    if (minimumV > upper || maximumU - minimumU <= 2 * halfSlab + EPS) return reject("monotoneFamilyMetricRejectedCells")
    const centerU = (minimumU + maximumU) / 2
    const targets = pairs.map((pair) => horizontal ? (pair.a.core.y + pair.b.core.y) / 2 : (pair.a.core.x + pair.b.core.x) / 2)
    const key = JSON.stringify(["annulus-and-drill-v1", spacingRule, horizontal ? "x" : "y", pairs.map((pair) => [pair.a.core.z, pair.b.core.z])])
    const lanes = compileMonotoneLaneTemplate({ key, targets, separation, lower: minimumV, upper, cache: params.cache, stats })
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]!, lane = lanes[i]!
      const left = horizontal ? { x: centerU - halfSlab, y: lane } : { x: lane, y: centerU - halfSlab }
      const site = horizontal ? { x: centerU, y: lane } : { x: lane, y: centerU }
      const right = horizontal ? { x: centerU + halfSlab, y: lane } : { x: lane, y: centerU + halfSlab }
      const points: Point[] = [pair.a.port, pair.a.core, { ...left, z: pair.a.core.z }, { ...site, z: pair.a.core.z }]
      const vias: Array<{ x: number; y: number }> = []
      if (pair.a.core.z !== pair.b.core.z) { points.push({ ...site, z: pair.b.core.z }); vias.push(site) }
      points.push({ ...right, z: pair.b.core.z }, pair.b.core, pair.b.port)
      if (pair.reversed) points.reverse()
      routes.push({ connectionName: pair.a.port.connectionName, rootConnectionName: pair.a.port.rootConnectionName, traceThickness: traceWidth, viaDiameter, route: points.map((p) => ({ x: p.x, y: p.y, z: p.z })), vias, regionId: node.capacityMeshNodeId })
    }
    stats.monotoneFamilyCollectiveCells = 1
  }
  stats.monotoneFamilyEligibleCells = 1
  const board = { layerCount: params.layerCount, allowBlindAndBuriedVias: params.allowBlindAndBuriedVias }
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]!, root = params.connMap ? getCanonicalPipeline9PortRoot(route, params.connMap) : route.rootConnectionName ?? route.connectionName
    if (!routeMeetsPhysicalDomain(route, params, stats)) return reject("monotoneFamilyPhysicalDomainRejectedCells")
    for (let j = 0; j < i; j++) {
      const sameNet = (params.connMap ? getCanonicalPipeline9PortRoot(routes[j]!, params.connMap) : routes[j]!.rootConnectionName ?? routes[j]!.connectionName) === root
      if (params.viaHoleDiameter !== undefined && params.viaHoleClearance !== undefined) {
        stats.monotoneFamilyDrillPredicates++
        if (monotoneFamilyRoutesHaveDrillConflict(route, routes[j]!, params.viaHoleDiameter, params.viaHoleClearance, sameNet, board)) return reject("monotoneFamilyClearanceRejectedCells")
      }
      if (sameNet) continue
      stats.monotoneFamilyPairPredicates++
      if (doPipeline9RoutesHaveCopperConflict({ left: route, right: routes[j]!, clearance: clearance + 1e-6, ...board })) return reject("monotoneFamilyClearanceRejectedCells")
    }
    const geometry = getPipeline9RouteCopperGeometry(route, board)
    for (const port of params.scenePorts) {
      if ((params.connMap ? getCanonicalPipeline9PortRoot(port, params.connMap) : port.rootConnectionName ?? port.connectionName) === root) continue
      for (const segment of geometry.wireSegments) {
        if (segment.z !== port.z) continue
        stats.monotoneFamilyScenePortPredicates++
        if (pointToSegmentDistance(port, segment.start, segment.end) < segment.width / 2 + traceWidth / 2 + clearance + 1e-6) return reject("monotoneFamilyClearanceRejectedCells")
      }
      for (const via of geometry.viaSpans) {
        if (port.z < via.minZ || port.z > via.maxZ) continue
        stats.monotoneFamilyScenePortPredicates++
        if (Math.hypot(port.x - via.center.x, port.y - via.center.y) < via.diameter / 2 + traceWidth / 2 + clearance + 1e-6) return reject("monotoneFamilyClearanceRejectedCells")
      }
    }
    for (const other of params.sceneRoutes) {
      const sameNet = (params.connMap ? getCanonicalPipeline9PortRoot(other, params.connMap) : other.rootConnectionName ?? other.connectionName) === root
      if (params.viaHoleDiameter !== undefined && params.viaHoleClearance !== undefined) {
        stats.monotoneFamilyDrillPredicates++
        if (monotoneFamilyRoutesHaveDrillConflict(route, other, params.viaHoleDiameter, params.viaHoleClearance, sameNet, board)) return reject("monotoneFamilyClearanceRejectedCells")
      }
      if (sameNet) continue
      stats.monotoneFamilySceneRoutePredicates++
      if (doPipeline9RoutesHaveCopperConflict({ left: route, right: other, clearance: clearance + 1e-6, ...board })) return reject("monotoneFamilyClearanceRejectedCells")
    }
  }
  stats.monotoneFamilySolvedCells = 1; stats.monotoneFamilyConstructedRoutes = routes.length
  stats.monotoneFamilyConstructedVias = routes.reduce((count, route) => count + route.vias.length, 0)
  return { applicable: true, routes, stats }
}

/** Exact-site same-net reuse is one physical drill; distinct sites must respect
 * the caller's actual hole diameter/gap even when their copper may touch. */
export function monotoneFamilyRoutesHaveDrillConflict(left: HighDensityIntraNodeRoute, right: HighDensityIntraNodeRoute, holeDiameter: number, holeGap: number, sameNet: boolean, board: { layerCount: number; allowBlindAndBuriedVias?: boolean }): boolean {
  const first = getPipeline9RouteCopperGeometry(left, board).viaSpans
  const second = getPipeline9RouteCopperGeometry(right, board).viaSpans
  for (const a of first) for (const b of second) {
    const distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)
    if (sameNet && a.center.x === b.center.x && a.center.y === b.center.y) continue
    if (distance < holeDiameter + holeGap + 1e-6) return true
  }
  return false
}

/** Keep registered connection ownership authoritative over alias-like root keys. */
export function normalizePipeline9MonotoneRoots(node: NodeWithPortPoints, connMap: ConnectivityMap): NodeWithPortPoints {
  const normalize = (port: PortPoint): PortPoint => ({ ...port, rootConnectionName: getCanonicalPipeline9PortRoot(port, connMap) })
  return {
    ...node,
    portPoints: node.portPoints.map(normalize),
    portPointsInPairs: node.portPointsInPairs?.map(([a, b]) => [normalize(a), normalize(b)]),
  }
}
