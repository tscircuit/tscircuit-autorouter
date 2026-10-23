import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { doPipeline9RoutesHaveCopperConflict, getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { createPipeline9CellInterfaceSupport } from "./createPipeline9CellInterfaceSupport"
import type { Pipeline9ParametricInterfacePort } from "./Pipeline9ParametricInterfaceIndex"
import { isPipeline9ObstacleOwnedByRoute } from "./isPipeline9ObstacleOwnedByRoute"

type Point = HighDensityRoute["route"][number]
type Params = {
  node: NodeWithPortPoints
  obstacles: Obstacle[]
  boardGeometry?: HighDensityBoardGeometry
  connMap: ConnectivityMap
  layerCount: number
  traceWidth: number
  traceWidthByConnection?: Readonly<Record<string, number>>
  traceToPadClearance?: number
  viaToPadClearance?: number
  traceToHoleClearance?: number
  viaDiameter: number
  obstacleMargin: number
  allowBlindAndBuriedVias?: boolean
  interfacePolicy?: "owned-normal-escapes"
  interfacePortPoints?: readonly Pipeline9ParametricInterfacePort[]
}
type Formula = { name: string; points: Point[] }
type Stats = {
  parametricFormulaCount: number
  parametricDomainChecks: number
  parametricAssignmentChecks: number
  parametricCompiledRouteCount: number
  parametricCompiledViaCount: number
  parametricElbowRouteCount: number
  parametricSignatureCount: number
  parametricExhaustedAssignments: number
  parametricObstacleDistanceChecks: number
  parametricInterfacePairChecks: number
  parametricInterfaceUnsupportedPairs: number
  parametricInterfaceCandidateChecks: number
  parametricInterfaceCandidateRejections: number
  parametricInterfaceNormalEscapeFormulas: number
  parametricInterfaceCertifiedRoutes: number
  parametricInterfacePolicyNodeCount: number
  parametricInterfaceTerminalEscapes: number
  parametricInterfaceReservationChecks: number
  parametricInterfaceInheritedTerminalContacts: number
}
export type ParametricCellConstruction = {
  applicable: boolean
  routes: HighDensityRoute[]
  stats: Stats
}

// These are coordinate formulas, not previously routed examples. A signature
// selects a finite set of affine constructions; exact domain predicates below
// certify the supplied dimensions, copper widths, layers and obstacle geometry.
function instantiatePlanarFormulas(a: Point, b: Point): Formula[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.min(Math.abs(dx), Math.abs(dy))
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  const formulas: Formula[] = [
    { name: "diagonal-first", points: [a, { x: a.x + sx * d, y: a.y + sy * d, z: a.z }, b] },
    { name: "diagonal-last", points: [a, { x: b.x - sx * d, y: b.y - sy * d, z: a.z }, b] },
    { name: "horizontal-first", points: [a, { x: b.x, y: a.y, z: a.z }, b] },
    { name: "vertical-first", points: [a, { x: a.x, y: b.y, z: a.z }, b] },
    { name: "horizontal-dogleg", points: [a, { x: (a.x + b.x) / 2, y: a.y, z: a.z }, { x: (a.x + b.x) / 2, y: b.y, z: a.z }, b] },
    { name: "vertical-dogleg", points: [a, { x: a.x, y: (a.y + b.y) / 2, z: a.z }, { x: b.x, y: (a.y + b.y) / 2, z: a.z }, b] },
  ]
  const unique = new Map<string, Formula>()
  for (const formula of formulas) {
    const points = formula.points.filter((p, i, all) => i === 0 || p.x !== all[i - 1]!.x || p.y !== all[i - 1]!.y || p.z !== all[i - 1]!.z)
    const key = points.map((p) => `${p.x},${p.y},${p.z}`).join(";")
    if (!unique.has(key)) unique.set(key, { name: formula.name, points })
  }
  return [...unique.values()]
}

function instantiateFormulas(a: PortPoint, b: PortPoint, viaCore?: { minX: number; maxX: number; minY: number; maxY: number } | null): Formula[] {
  const start = { x: a.x, y: a.y, z: a.z }
  const end = { x: b.x, y: b.y, z: b.z }
  if (a.z === b.z) return instantiatePlanarFormulas(start, end)
  const sites = [
    { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    { x: (a.x + b.x) / 2, y: a.y },
    { x: (a.x + b.x) / 2, y: b.y },
    { x: a.x, y: (a.y + b.y) / 2 },
    { x: b.x, y: (a.y + b.y) / 2 },
  ]
  return sites.flatMap((rawSite, i) => {
    const site = viaCore ? { x: Math.max(viaCore.minX, Math.min(viaCore.maxX, rawSite.x)), y: Math.max(viaCore.minY, Math.min(viaCore.maxY, rawSite.y)) } : rawSite
    const before = { ...site, z: a.z }
    const after = { ...site, z: b.z }
    const first = instantiatePlanarFormulas(start, before).slice(0, 2)
    const second = instantiatePlanarFormulas(after, end).slice(0, 2)
    return first.flatMap((left) => second.map((right) => ({
      name: `via-${i}:${left.name}:${right.name}`,
      points: [...left.points, ...right.points],
    })))
  })
}

function distanceToObstacle(start: Point, end: Point, obstacle: Obstacle): number {
  if (obstacle.shape === "circle") {
    // max rather than min also encloses imported non-circular ellipses.
    return pointToSegmentDistance(obstacle.center, start, end) - Math.max(obstacle.width, obstacle.height) / 2
  }
  const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
  const local = (p: Point): Point => ({ x: (p.x - obstacle.center.x) * Math.cos(angle) - (p.y - obstacle.center.y) * Math.sin(angle), y: (p.x - obstacle.center.x) * Math.sin(angle) + (p.y - obstacle.center.y) * Math.cos(angle), z: p.z })
  const a = local(start)
  const b = local(end)
  const hx = obstacle.width / 2
  const hy = obstacle.height / 2
  if ([a, b].some((p) => Math.abs(p.x) <= hx && Math.abs(p.y) <= hy)) return 0
  const corners = [{ x: -hx, y: -hy }, { x: hx, y: -hy }, { x: hx, y: hy }, { x: -hx, y: hy }]
  return Math.min(...corners.map((p, i) => minimumDistanceBetweenSegments(a, b, p, corners[(i + 1) % 4]!)))
}

function satisfiesPhysicalDomain(route: HighDensityRoute, params: Params, stats: Stats): boolean {
  const { node, boardGeometry, layerCount, allowBlindAndBuriedVias } = params
  const copper = getPipeline9RouteCopperGeometry(route, { layerCount, allowBlindAndBuriedVias })
  const polygon = boardGeometry ? boardGeometry.outline && boardGeometry.outline.length >= 3 ? boardGeometry.outline : [
    { x: boardGeometry.bounds.minX, y: boardGeometry.bounds.minY },
    { x: boardGeometry.bounds.maxX, y: boardGeometry.bounds.minY },
    { x: boardGeometry.bounds.maxX, y: boardGeometry.bounds.maxY },
    { x: boardGeometry.bounds.minX, y: boardGeometry.bounds.maxY },
  ] : undefined
  const wires = copper.wireSegments.map((s) => ({ start: s.start, end: s.end, minZ: s.z, maxZ: s.z, radius: s.width / 2, via: false }))
  const vias = copper.viaSpans.map((v) => ({ start: { ...v.center, z: v.minZ }, end: { ...v.center, z: v.maxZ }, minZ: v.minZ, maxZ: v.maxZ, radius: v.diameter / 2, via: true }))
  for (const primitive of [...wires, ...vias]) {
    for (const point of [primitive.start, primitive.end]) {
      if (point.x < node.center.x - node.width / 2 - 1e-9 || point.x > node.center.x + node.width / 2 + 1e-9 || point.y < node.center.y - node.height / 2 - 1e-9 || point.y > node.center.y + node.height / 2 + 1e-9) return false
    }
    if (polygon && (!isPointInOrOnPolygon(primitive.start, polygon) || !isPointInOrOnPolygon(primitive.end, polygon) || polygon.some((p, i) => minimumDistanceBetweenSegments(primitive.start, primitive.end, p, polygon[(i + 1) % polygon.length]!) < primitive.radius + (boardGeometry?.minBoardEdgeClearance ?? 0.15) + 1e-6))) return false
    for (const obstacle of params.obstacles) {
      const layers = obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
      if (!layers.some((z) => z >= primitive.minZ && z <= primitive.maxZ)) continue
      if (!primitive.via && !obstacle.isNonPlatedHole && (params.interfacePolicy ? isPipeline9ObstacleOwnedByRoute(obstacle, route, params.connMap) : isObstacleConnectedToRoute(obstacle, route, params.connMap))) continue
      const clearance = Math.max(params.obstacleMargin, obstacle.isNonPlatedHole ? params.traceToHoleClearance ?? 0 : primitive.via ? params.viaToPadClearance ?? 0 : params.traceToPadClearance ?? 0)
      stats.parametricObstacleDistanceChecks++
      if (distanceToObstacle(primitive.start, primitive.end, obstacle) < primitive.radius + clearance + 1e-6) return false
    }
  }
  return true
}

/** Compile a compatible family, including elbow and layer-transition domains. */
export function constructPipeline9ParametricCell(params: Params): ParametricCellConstruction {
  const { node, layerCount, traceWidth, viaDiameter, obstacleMargin } = params
  if (params.interfacePolicy !== undefined && params.interfacePolicy !== "owned-normal-escapes") throw new Error("Parametric cell has an unknown interface policy")
  if (params.interfacePolicy && !params.interfacePortPoints) throw new Error("Parametric cell interface policy requires immutable scene reservations")
  if (![node.center.x, node.center.y, node.width, node.height, traceWidth, viaDiameter, obstacleMargin].every(Number.isFinite) || node.width <= 0 || node.height <= 0 || traceWidth <= 0 || viaDiameter <= 0 || obstacleMargin < 0 || !Number.isInteger(layerCount) || layerCount < 1 || node.portPoints.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isInteger(p.z) || p.z < 0 || p.z >= layerCount) || params.obstacles.some((o) => ![o.center.x, o.center.y, o.width, o.height, o.ccwRotationDegrees ?? 0].every(Number.isFinite) || o.width < 0 || o.height < 0)) throw new Error(`Pipeline9 parametric cell ${node.capacityMeshNodeId} has invalid geometry`)
  if (params.boardGeometry && (!Object.values(params.boardGeometry.bounds).every(Number.isFinite) || params.boardGeometry.bounds.minX >= params.boardGeometry.bounds.maxX || params.boardGeometry.bounds.minY >= params.boardGeometry.bounds.maxY || !Number.isFinite(params.boardGeometry.minBoardEdgeClearance ?? 0.15) || (params.boardGeometry.minBoardEdgeClearance ?? 0.15) < 0 || params.boardGeometry.outline?.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error("Pipeline9 parametric cell has invalid board geometry")
  if (Object.values(params.traceWidthByConnection ?? {}).some((width) => !Number.isFinite(width) || width <= 0) || [params.viaToPadClearance, params.traceToHoleClearance, params.traceToPadClearance].some((gap) => gap !== undefined && (!Number.isFinite(gap) || gap < 0))) throw new Error("Pipeline9 parametric cell has invalid physical rules")
  const stats: Stats = { parametricFormulaCount: 0, parametricDomainChecks: 0, parametricAssignmentChecks: 0, parametricCompiledRouteCount: 0, parametricCompiledViaCount: 0, parametricElbowRouteCount: 0, parametricSignatureCount: 0, parametricExhaustedAssignments: 0, parametricObstacleDistanceChecks: 0,
    parametricInterfacePairChecks: 0, parametricInterfaceUnsupportedPairs: 0, parametricInterfaceCandidateChecks: 0,
    parametricInterfaceCandidateRejections: 0, parametricInterfaceNormalEscapeFormulas: 0, parametricInterfaceCertifiedRoutes: 0,
    parametricInterfacePolicyNodeCount: Number(params.interfacePolicy !== undefined), parametricInterfaceTerminalEscapes: 0,
    parametricInterfaceReservationChecks: 0, parametricInterfaceInheritedTerminalContacts: 0 }
  const byConnection = new Map<string, PortPoint[]>()
  for (const port of node.portPoints) {
    const ports = byConnection.get(port.connectionName) ?? []
    ports.push(port)
    byConnection.set(port.connectionName, ports)
  }
  const pairs = node.portPointsInPairs?.length ? node.portPointsInPairs : [...byConnection.values()].flatMap(getConnectionPortPointPairs)
  for (const pair of pairs) {
    for (const endpoint of pair) {
      if (!Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y) || !Number.isInteger(endpoint.z) || endpoint.z < 0 || endpoint.z >= layerCount) throw new Error("Parametric pair endpoint has invalid geometry")
      const witness = node.portPoints.find((port) =>
        (endpoint.portPointId === undefined || endpoint.portPointId === port.portPointId) &&
        endpoint.connectionName === port.connectionName &&
        (endpoint.rootConnectionName ?? endpoint.connectionName) === (port.rootConnectionName ?? port.connectionName) &&
        endpoint.pcb_port_id === port.pcb_port_id && endpoint.x === port.x && endpoint.y === port.y && endpoint.z === port.z,
      )
      if (!witness) throw new Error("Parametric pair endpoint does not match the declared node interface")
    }
  }
  if (node.availableZ?.some((z) => !Number.isInteger(z) || z < 0 || z >= layerCount) || params.obstacles.some((obstacle) => (obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))).some((z) => !Number.isInteger(z) || z < 0 || z >= layerCount))) throw new Error("Parametric physical domain has invalid copper layers")
  // Keep the exact physical/domain signature small. Larger interfaces belong
  // to the ordinary detailed solver, before any construction is committed.
  if (pairs.length > 12 || node.portPoints.some((p) => node.availableZ !== undefined && !node.availableZ.includes(p.z))) return { applicable: false, routes: [], stats }
  const signatures = new Set<string>()
  const domains = pairs.map(([a, b]) => {
    if (a.connectionName !== b.connectionName || (a.rootConnectionName ?? a.connectionName) !== (b.rootConnectionName ?? b.connectionName)) throw new Error("Parametric route pair changes electrical ownership")
    const dx = b.x - a.x
    const dy = b.y - a.y
    signatures.add(`${Math.sign(dx)}:${Math.sign(dy)}:${Math.sign(Math.abs(dx) - Math.abs(dy))}:${a.z === b.z}`)
    const candidates: HighDensityRoute[] = []
    const width = Math.max(traceWidth, params.traceWidthByConnection?.[a.connectionName] ?? traceWidth)
    const support = params.interfacePolicy === "owned-normal-escapes" ? createPipeline9CellInterfaceSupport({ ...params, interfacePortPoints: params.interfacePortPoints!, pair: [a, b], traceWidth: width, clearance: Math.max(obstacleMargin, 0.1) }) : undefined
    if (params.interfacePolicy) {
      stats.parametricInterfacePairChecks++
      if (!support) { stats.parametricInterfaceUnsupportedPairs++; return candidates }
      stats.parametricInterfaceTerminalEscapes += support.terminalEscapeCount
    }
    const formulas = instantiateFormulas(a, b)
    if (support) {
      const [coreA, coreB] = support.coreEndpoints
      for (const formula of instantiateFormulas({ ...a, ...coreA }, { ...b, ...coreB }, support.viaCore)) {
        const points = [{ x: a.x, y: a.y, z: a.z }, ...formula.points, { x: b.x, y: b.y, z: b.z }].filter((point, i, all) => i === 0 || point.x !== all[i - 1]!.x || point.y !== all[i - 1]!.y || point.z !== all[i - 1]!.z)
        formulas.push({ name: `normal-escape:${formula.name}`, points })
        stats.parametricInterfaceNormalEscapeFormulas++
      }
    }
    const formulaKeys = new Set<string>()
    for (const formula of formulas) {
      const key = formula.points.map((point) => `${point.x},${point.y},${point.z}`).join(";")
      if (support && formulaKeys.has(key)) continue
      formulaKeys.add(key)
      stats.parametricFormulaCount++
      if (formula.points.length < 2) continue
      const route: HighDensityRoute = { connectionName: a.connectionName, rootConnectionName: a.rootConnectionName ?? a.connectionName, regionId: node.capacityMeshNodeId, traceThickness: width, viaDiameter, route: formula.points, vias: formula.points.flatMap((p, i, all) => i > 0 && p.z !== all[i - 1]!.z ? [{ x: p.x, y: p.y }] : []) }
      if (support) {
        stats.parametricInterfaceCandidateChecks++
        const beforeChecks = support.reservationChecks, beforeInherited = support.inheritedTerminalContacts
        const certified = support.certify(route)
        stats.parametricInterfaceReservationChecks += support.reservationChecks - beforeChecks
        stats.parametricInterfaceInheritedTerminalContacts += support.inheritedTerminalContacts - beforeInherited
        if (!certified) { stats.parametricInterfaceCandidateRejections++; continue }
      }
      stats.parametricDomainChecks++
      if (satisfiesPhysicalDomain(route, params, stats)) candidates.push(route)
    }
    candidates.sort((a, b) => a.vias.length - b.vias.length || a.route.reduce((sum, p, i, all) => sum + (i ? Math.hypot(p.x - all[i - 1]!.x, p.y - all[i - 1]!.y) : 0), 0) - b.route.reduce((sum, p, i, all) => sum + (i ? Math.hypot(p.x - all[i - 1]!.x, p.y - all[i - 1]!.y) : 0), 0) || a.route.length - b.route.length)
    return candidates
  })
  stats.parametricSignatureCount = signatures.size
  if (domains.some((domain) => domain.length === 0)) return { applicable: false, routes: [], stats }
  const order = domains.map((_, i) => i).sort((a, b) => domains[a]!.length - domains[b]!.length)
  const selected = Array<HighDensityRoute>(pairs.length)
  const assign = (depth: number): boolean => {
    if (depth === order.length) return true
    const index = order[depth]!
    for (const route of domains[index]!) {
      if (++stats.parametricAssignmentChecks > 4096) { stats.parametricExhaustedAssignments = 1; return false }
      const conflict = order.slice(0, depth).some((other) => {
        const fixed = selected[other]!
        // Distinct physical holes require spacing even on the same net. Exact
        // coincident occurrences denote one shared via, not two drill sites.
        if (route.vias.some((a) => fixed.vias.some((b) => (a.x !== b.x || a.y !== b.y) && Math.hypot(a.x - b.x, a.y - b.y) < viaDiameter + obstacleMargin + 1e-6))) return true
        if ((route.rootConnectionName ?? route.connectionName) === (fixed.rootConnectionName ?? fixed.connectionName)) return false
        return doPipeline9RoutesHaveCopperConflict({ left: route, right: fixed, clearance: Math.max(obstacleMargin, 0.1) + 1e-6, layerCount, allowBlindAndBuriedVias: params.allowBlindAndBuriedVias })
      })
      if (conflict) continue
      selected[index] = route
      if (assign(depth + 1)) return true
      if (stats.parametricExhaustedAssignments) return false
    }
    return false
  }
  if (!assign(0)) return { applicable: false, routes: [], stats }
  stats.parametricCompiledRouteCount = selected.length
  stats.parametricInterfaceCertifiedRoutes = params.interfacePolicy ? selected.length : 0
  stats.parametricCompiledViaCount = selected.reduce((n, r) => n + r.vias.length, 0)
  stats.parametricElbowRouteCount = selected.filter((r) => r.route.length > 2).length
  return { applicable: true, routes: selected, stats }
}
