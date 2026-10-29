import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"

type Point = { x: number; y: number }
type Vertex = Point & { originalX: number; originalY: number; fixed: boolean; radius: number }
type Primitive = { a: number; b: number; radius: number; minZ: number; maxZ: number; routeIndex: number; via: boolean }
type ProjectionHalfSpace = {
  a: number; b: number; nx: number; ny: number; wa: number; wb: number
  denominator: number; minimumMotion: number; kind: "obstacle" | "hole"
}
type CompressionAnchor = { routeIndex: number } & (
  { kind: "point"; point: HighDensityIntraNodeRoute["route"][number]; pointIndex: number } |
  { kind: "via"; point: Point }
)
type Contact = { t: number; u: number; dx: number; dy: number; distance: number }
type Energy = { loss: number; maxPenetration: number; pairs: number; movableLoss: number; movableContacts: number; gx: Float64Array; gy: Float64Array; weight: Float64Array }
export type PhysicalRouteLegalizationMode = "off" | "compression-only" | "full" | "selective"
export type PhysicalRouteLegalizationParams = {
  routes: HighDensityIntraNodeRoute[]
  node: NodeWithPortPoints
  layerCount: number
  clearance: number
  connMap?: ConnectivityMap
  obstacles?: Obstacle[]
  boardGeometry?: HighDensityBoardGeometry
  allowBlindAndBuriedVias?: boolean
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  minTraceToHoleEdgeClearance?: number
  minTraceToPadEdgeClearance?: number
  viaToPadClearance?: number
  maxIterations?: number
  mode?: PhysicalRouteLegalizationMode
  projectionWorkLimit?: number
}

type PhysicalRouteLegalizationResultBase = {
  routes: HighDensityIntraNodeRoute[]
  mode: PhysicalRouteLegalizationMode
  stopReason: "disabled" | "compression-only" | "unsupported" | "no-pairwise-conflicts" | "no-movable-conflicts" | "no-descent" | "work-limit" | "progress-plateau" | "iteration-limit" | "clean-energy"
  elapsedMs: number
  iterations: number
  pointsBefore: number
  pointsAfter: number
  energyEvaluationCount: number
  geometryWork: number
  projectionWork: number
  projectionWorkLimit: number | null
  movableConflictCount: number | null
  immutableConflictCount: number | null
  energyMetricsRecorded: boolean
  drillMetricsRecorded: boolean
  independentCleanScope: "copper-only" | "copper-and-drill" | null
  movableLossBefore: number | null
  movableLossAfter: number | null
  candidateLoss?: number
  candidateCopperPairs?: number
  candidateOverlapPairs?: number
  obstacleGuardRejected?: boolean
  boardGuardRejected?: boolean
  independentCleanCheckPassed?: boolean
}
export type PhysicalRouteLegalizationResult = PhysicalRouteLegalizationResultBase & ({
  status: "disabled" | "compressed" | "unsupported"
  metricsRecorded: false
  copperPairsBefore: null
  copperPairsAfter: null
  overlapPairsBefore: null
  overlapPairsAfter: null
  holePairsBefore: null
  holePairsAfter: null
  lossBefore: null
  lossAfter: null
} | {
  status: "clean" | "improved-needs-repair" | "unchanged-needs-repair" | "not-needed"
  metricsRecorded: true
  copperPairsBefore: number
  copperPairsAfter: number
  overlapPairsBefore: number
  overlapPairsAfter: number
  holePairsBefore: number | null
  holePairsAfter: number | null
  lossBefore: number | null
  lossAfter: number | null
})

/** Exact segment closest points, including degenerate segments and crossings. */
const closestSegments = (a: Point, b: Point, c: Point, d: Point): Contact => {
  const ux = b.x - a.x, uy = b.y - a.y
  const vx = d.x - c.x, vy = d.y - c.y
  const wx = a.x - c.x, wy = a.y - c.y
  const aa = ux * ux + uy * uy, bb = ux * vx + uy * vy
  const cc = vx * vx + vy * vy, dd = ux * wx + uy * wy, ee = vx * wx + vy * wy
  const denominator = aa * cc - bb * bb
  let t = aa < 1e-20 ? 0 : denominator > 1e-20 ? Math.max(0, Math.min(1, (bb * ee - cc * dd) / denominator)) : 0
  let u = cc < 1e-20 ? 0 : (bb * t + ee) / cc
  if (cc < 1e-20 && aa >= 1e-20) t = Math.max(0, Math.min(1, -dd / aa))
  if (u < 0) { u = 0; t = aa < 1e-20 ? 0 : Math.max(0, Math.min(1, -dd / aa)) }
  if (u > 1) { u = 1; t = aa < 1e-20 ? 0 : Math.max(0, Math.min(1, (bb - dd) / aa)) }
  const dx = a.x + t * ux - c.x - u * vx
  const dy = a.y + t * uy - c.y - u * vy
  return { t, u, dx, dy, distance: Math.hypot(dx, dy) }
}

/** Preserve proposal junctions before reducing an individual route's vertices. */
const getRouteCompressionJunctions = (routes: HighDensityIntraNodeRoute[]): Set<HighDensityIntraNodeRoute["route"][number]> => {
  const entries: CompressionAnchor[] = []
  for (const [routeIndex, route] of routes.entries()) {
    for (const [pointIndex, point] of route.route.entries()) entries.push({ kind: "point", point, routeIndex, pointIndex })
    for (const point of route.vias) entries.push({ kind: "via", point, routeIndex })
  }
  const junctions = new Set<HighDensityIntraNodeRoute["route"][number]>()
  if (entries.length < 2) return junctions
  const index = new Flatbush(entries.length)
  for (const { point } of entries) index.add(point.x, point.y, point.x, point.y)
  index.finish()
  for (const entry of entries) {
    if (entry.kind === "via") continue
    const { point } = entry
    const nearby = index.search(point.x - 1e-9, point.y - 1e-9, point.x + 1e-9, point.y + 1e-9)
    if (nearby.some((otherIndex) => {
      const other = entries[otherIndex]!
      // A via center anchors every layer; ordinary point contacts share a layer.
      return (other.kind === "via" || other.point.z === point.z) &&
        (other.routeIndex !== entry.routeIndex || other.kind === "via" || Math.abs(other.pointIndex - entry.pointIndex) > 1) &&
        Math.hypot(other.point.x - point.x, other.point.y - point.y) < 1e-9
    })) junctions.add(point)
  }
  return junctions
}

/** Remove collinear points without distinct physical or identity metadata. */
const compressRoutes = (routes: HighDensityIntraNodeRoute[], node: NodeWithPortPoints): HighDensityIntraNodeRoute[] => {
  const junctions = getRouteCompressionJunctions(routes)
  return routes.map((route) => {
    const points: HighDensityIntraNodeRoute["route"] = []
    for (const point of route.route) {
      while (points.length >= 2) {
        const a = points[points.length - 2]!, b = points[points.length - 1]!
        const dx1 = b.x - a.x, dy1 = b.y - a.y, dx2 = point.x - b.x, dy2 = point.y - b.y
        const scale = Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2)
        if (a.z !== b.z || b.z !== point.z || b.pcb_port_id || b.insideJumperPad || b.toNextSegmentType ||
          junctions.has(b) ||
          // Repeated route ownership is not a point identity. Actual junctions
          // were indexed across the proposal; unknown metadata remains inert.
          Object.keys(b).some((key) => {
            if (key === "x" || key === "y" || key === "z" || key === "traceThickness") return false
            if (key !== "connectionName" && key !== "rootConnectionName") return true
            const owner = route[key]
            return [a, b, point].some((vertex) =>
              (vertex as unknown as Record<string, unknown>)[key] !== owner)
          }) ||
          node.portPoints.some((port) => port.z === b.z && Math.hypot(port.x - b.x, port.y - b.y) < 1e-9) ||
          a.toNextSegmentType || b.toNextSegmentCircuitJsonMetadata ||
          (a.traceThickness ?? route.traceThickness) !== (b.traceThickness ?? route.traceThickness) ||
          (b.traceThickness ?? route.traceThickness) !== (point.traceThickness ?? route.traceThickness) ||
          Math.abs(dx1 * dy2 - dy1 * dx2) > 1e-12 * Math.max(scale, 1e-12) ||
          dx1 * dx2 + dy1 * dy2 < 0 || route.vias.some((via) => Math.hypot(via.x - b.x, via.y - b.y) < 1e-9)) break
        points.pop()
      }
      points.push(point)
    }
    return { ...route, route: points.map((point) => ({ ...point })), vias: route.vias.map((via) => ({ ...via })) }
  })
}

/** Separate final audit: no optimizer closest-point or broad-phase state. */
const isPhysicalProposalClean = (params: PhysicalRouteLegalizationParams): boolean => {
  const { routes, layerCount, connMap, boardGeometry, clearance } = params
  const geometries = routes.map((route) => getPipeline9RouteCopperGeometry(route, params))
  const sameNet = (i: number, j: number): boolean => {
    const left = routes[i]!, right = routes[j]!
    if (connMap) return arePipeline9RoutesOnSameNet(left, right, connMap)
    return left.connectionName === right.connectionName ||
      (left.rootConnectionName ?? left.connectionName) === (right.rootConnectionName ?? right.connectionName)
  }
  for (let i = 0; i < routes.length; i++) for (let j = i; j < routes.length; j++) {
    if (i !== j && !sameNet(i, j) && doPipeline9RoutesHaveCopperConflict({ left: routes[i]!, right: routes[j]!,
      clearance, layerCount, allowBlindAndBuriedVias: params.allowBlindAndBuriedVias })) return false
    if (params.viaHoleDiameter === undefined) continue
    const leftVias = geometries[i]!.viaSpans, rightVias = geometries[j]!.viaSpans
    for (const [aIndex, left] of leftVias.entries()) for (const [bIndex, right] of rightVias.entries()) {
      if (i === j && bIndex <= aIndex || left.minZ > right.maxZ || right.minZ > left.maxZ) continue
      const distance = Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y)
      if (sameNet(i, j) && distance <= 1e-9) continue
      if (distance < params.viaHoleDiameter + (params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0) - 1e-9) return false
    }
  }
  for (const [routeIndex, route] of routes.entries()) {
    const geometry = geometries[routeIndex]!
    const capsules = [
      ...geometry.wireSegments.map((wire) => ({ a: wire.start, b: wire.end, radius: wire.width / 2, minZ: wire.z, maxZ: wire.z, via: false })),
      ...geometry.viaSpans.map((via) => ({ a: via.center, b: via.center, radius: via.diameter / 2, minZ: via.minZ, maxZ: via.maxZ, via: true })),
    ]
    for (const capsule of capsules) {
      const edgeMargin = capsule.radius + (boardGeometry?.minBoardEdgeClearance ?? 0)
      const bounds = boardGeometry?.bounds
      if (bounds && (Math.min(capsule.a.x, capsule.b.x) < bounds.minX + edgeMargin - 1e-9 ||
        Math.max(capsule.a.x, capsule.b.x) > bounds.maxX - edgeMargin + 1e-9 ||
        Math.min(capsule.a.y, capsule.b.y) < bounds.minY + edgeMargin - 1e-9 ||
        Math.max(capsule.a.y, capsule.b.y) > bounds.maxY - edgeMargin + 1e-9)) return false
      const outline = boardGeometry?.outline
      if (outline) {
        if (!isPointInOrOnPolygon(capsule.a, outline) || !isPointInOrOnPolygon(capsule.b, outline)) return false
        for (let edge = 0; edge < outline.length; edge++) if (minimumDistanceBetweenSegments(capsule.a, capsule.b,
          outline[edge]!, outline[(edge + 1) % outline.length]!) < edgeMargin - 1e-9) return false
      }
      for (const obstacle of params.obstacles ?? []) {
        const zs = obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
        if (!zs.some((z) => z >= capsule.minZ && z <= capsule.maxZ)) continue
        const connected = obstacle.connectedTo.some((id) =>
          id === route.connectionName || id === route.rootConnectionName || connMap?.areIdsConnected(id, route.connectionName) ||
          route.rootConnectionName !== undefined && connMap?.areIdsConnected(id, route.rootConnectionName))
        if (connected && !capsule.via) continue
        const margin = capsule.radius + (obstacle.isNonPlatedHole ? params.minTraceToHoleEdgeClearance ?? clearance :
          capsule.via ? params.viaToPadClearance ?? clearance : params.minTraceToPadEdgeClearance ?? clearance)
        if (obstacle.shape === "circle") {
          if (minimumDistanceBetweenSegments(capsule.a, capsule.b, obstacle.center, obstacle.center) <
            margin + Math.max(obstacle.width, obstacle.height) / 2 - 1e-9) return false
          continue
        }
        const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const cosine = Math.cos(angle), sine = Math.sin(angle)
        const points = [capsule.a, capsule.b].map((point) => ({
          x: cosine * (point.x - obstacle.center.x) - sine * (point.y - obstacle.center.y),
          y: sine * (point.x - obstacle.center.x) + cosine * (point.y - obstacle.center.y),
        }))
        const hx = obstacle.width / 2, hy = obstacle.height / 2
        if (points.some((point) => Math.abs(point.x) <= hx && Math.abs(point.y) <= hy)) return false
        const corners = [{ x: -hx, y: -hy }, { x: hx, y: -hy }, { x: hx, y: hy }, { x: -hx, y: hy }]
        for (let edge = 0; edge < 4; edge++) if (minimumDistanceBetweenSegments(points[0]!, points[1]!,
          corners[edge]!, corners[(edge + 1) % 4]!) < margin - 1e-9) return false
      }
    }
  }
  return true
}

/**
 * A bounded physical embedding of a grown topology, not a new routing attempt.
 * Terminal/layer/via identities remain fixed. Incomplete legalization is an
 * explicit proposal for the existing downstream repair, never a clean claim.
 */
export const legalizeHighDensityRouteProposal = (params: PhysicalRouteLegalizationParams): PhysicalRouteLegalizationResult => {
  const startedAt = performance.now()
  const mode = params.mode ?? "full"
  if (!["off", "compression-only", "full", "selective"].includes(mode)) throw new Error(`Unknown physical legalization mode: ${mode}`)
  const original = params.routes
  const pointsBefore = original.reduce((sum, route) => sum + route.route.length, 0)
  const unmeasuredResult = (status: "disabled" | "compressed" | "unsupported", routes: HighDensityIntraNodeRoute[]): PhysicalRouteLegalizationResult => ({
    routes, mode, status, stopReason: status === "disabled" ? "disabled" : status === "compressed" ? "compression-only" : "unsupported",
    metricsRecorded: false, elapsedMs: performance.now() - startedAt, iterations: 0,
    pointsBefore, pointsAfter: routes.reduce((sum, route) => sum + route.route.length, 0),
    copperPairsBefore: null, copperPairsAfter: null, overlapPairsBefore: null, overlapPairsAfter: null,
    holePairsBefore: null, holePairsAfter: null, lossBefore: null, lossAfter: null,
    energyEvaluationCount: 0, geometryWork: 0, projectionWork: 0, projectionWorkLimit: null,
    movableConflictCount: null, immutableConflictCount: null, movableLossBefore: null, movableLossAfter: null, energyMetricsRecorded: false,
    drillMetricsRecorded: false, independentCleanScope: null,
  })
  if (mode === "off") return unmeasuredResult("disabled", original)
  const unsupported = original.some((route) => route.jumpers?.length || route.route.some((point) => point.toNextSegmentType))
  if (unsupported) return unmeasuredResult("unsupported", original)
  const { node } = params
  const routes = compressRoutes(original, node)
  if (mode === "compression-only") return unmeasuredResult("compressed", routes)
  const { layerCount, clearance, connMap } = params
  const sameNet = original.map((left) => original.map((right) => connMap
    ? arePipeline9RoutesOnSameNet(left, right, connMap)
    : left.connectionName === right.connectionName ||
      (left.rootConnectionName ?? left.connectionName) === (right.rootConnectionName ?? right.connectionName)))
  const pairCount = (routes: HighDensityIntraNodeRoute[], margin: number): number => {
    let count = 0
    for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
      if (!sameNet[i]![j] && doPipeline9RoutesHaveCopperConflict({ left: routes[i]!, right: routes[j]!, clearance: margin,
        layerCount, allowBlindAndBuriedVias: params.allowBlindAndBuriedVias })) count++
    }
    return count
  }
  const holePairCount = (candidateRoutes: HighDensityIntraNodeRoute[]): number | null => {
    if (params.viaHoleDiameter === undefined) return candidateRoutes.some((route) => route.vias.length > 0 ||
      route.route.some((point, i) => i > 0 && point.z !== route.route[i - 1]!.z)) ? null : 0
    const geometries = candidateRoutes.map((route) => getPipeline9RouteCopperGeometry(route, params))
    const required = params.viaHoleDiameter + (params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0)
    let count = 0
    for (let i = 0; i < geometries.length; i++) for (let j = i; j < geometries.length; j++) {
      for (const [aIndex, left] of geometries[i]!.viaSpans.entries()) for (const [bIndex, right] of geometries[j]!.viaSpans.entries()) {
        if (i === j && bIndex <= aIndex || left.minZ > right.maxZ || right.minZ > left.maxZ) continue
        const distance = Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y)
        if (sameNet[i]![j] && distance <= 1e-9) continue
        if (distance < required - 1e-9) count++
      }
    }
    return count
  }
  const copperPairsBefore = pairCount(routes, clearance)
  const overlapPairsBefore = pairCount(routes, 0)
  const holePairsBefore = holePairCount(routes)
  if (copperPairsBefore === 0 && (holePairsBefore === 0 || holePairsBefore === null)) return {
    routes: original, mode, metricsRecorded: true, status: "not-needed", stopReason: "no-pairwise-conflicts", elapsedMs: performance.now() - startedAt,
    iterations: 0, pointsBefore, pointsAfter: pointsBefore, copperPairsBefore, copperPairsAfter: copperPairsBefore,
    overlapPairsBefore, overlapPairsAfter: overlapPairsBefore, lossBefore: null, lossAfter: null,
    holePairsBefore, holePairsAfter: holePairsBefore, energyEvaluationCount: 0, geometryWork: 0, projectionWork: 0,
    projectionWorkLimit: null, movableConflictCount: null, immutableConflictCount: null, movableLossBefore: null, movableLossAfter: null, energyMetricsRecorded: false,
    drillMetricsRecorded: holePairsBefore !== null, independentCleanScope: null,
  }
  const vertices: Vertex[] = []
  const vertexByOwnerXY = new Map<string, number>()
  const routeVertices: number[][] = []
  const owners = original.map((_, i) => sameNet[i]!.findIndex(Boolean))
  const xyKey = (routeIndex: number, point: Point): string => `${owners[routeIndex]}:${point.x}:${point.y}`
  for (const [routeIndex, route] of routes.entries()) {
    routeVertices.push(route.route.map((point, pointIndex) => {
      const key = xyKey(routeIndex, point)
      const fixed = pointIndex === 0 || pointIndex === route.route.length - 1 || point.pcb_port_id !== undefined ||
        node.portPoints.some((port) => Math.hypot(port.x - point.x, port.y - point.y) < 1e-9 && port.z === point.z &&
          (port.connectionName === route.connectionName || port.rootConnectionName === route.rootConnectionName && port.rootConnectionName !== undefined ||
            connMap?.areIdsConnected(port.connectionName, route.connectionName)))
      const previous = vertexByOwnerXY.get(key)
      if (previous !== undefined) {
        vertices[previous]!.fixed ||= fixed
        vertices[previous]!.radius = Math.max(vertices[previous]!.radius, (point.traceThickness ?? route.traceThickness) / 2)
        return previous
      }
      const index = vertices.length
      vertexByOwnerXY.set(key, index)
      vertices.push({ x: point.x, y: point.y, originalX: point.x, originalY: point.y,
        fixed, radius: (point.traceThickness ?? route.traceThickness) / 2 })
      return index
    }))
  }
  const primitives: Primitive[] = []
  for (const [routeIndex, route] of routes.entries()) {
    const geometry = getPipeline9RouteCopperGeometry(route, { layerCount, allowBlindAndBuriedVias: params.allowBlindAndBuriedVias })
    const vertexIndex = (point: Point): number => {
      const index = vertexByOwnerXY.get(xyKey(routeIndex, point))
      if (index === undefined) throw new Error(`Physical legalization cannot find a vertex for ${route.connectionName}`)
      return index
    }
    for (const wire of geometry.wireSegments) primitives.push({ a: vertexIndex(wire.start), b: vertexIndex(wire.end),
      radius: wire.width / 2, minZ: wire.z, maxZ: wire.z, routeIndex, via: false })
    for (const via of geometry.viaSpans) {
      const index = vertexIndex(via.center)
      vertices[index]!.radius = Math.max(vertices[index]!.radius, via.diameter / 2)
      primitives.push({ a: index, b: index, radius: via.diameter / 2, minZ: via.minZ, maxZ: via.maxZ, routeIndex, via: true })
    }
  }
  const externalViolations = (positions: Point[]): Set<string> => {
    const violations = new Set<string>()
    for (const [i, primitive] of primitives.entries()) {
      const a = positions[primitive.a]!, b = positions[primitive.b]!
      const margin = primitive.radius + (params.boardGeometry?.minBoardEdgeClearance ?? 0)
      const boardBounds = params.boardGeometry?.bounds
      if (boardBounds && (Math.min(a.x, b.x) < boardBounds.minX + margin - 1e-8 || Math.max(a.x, b.x) > boardBounds.maxX - margin + 1e-8 ||
        Math.min(a.y, b.y) < boardBounds.minY + margin - 1e-8 || Math.max(a.y, b.y) > boardBounds.maxY - margin + 1e-8)) violations.add(`edge:${i}`)
      const outline = params.boardGeometry?.outline
      if (!outline) continue
      if (!isPointInOrOnPolygon(a, outline) || !isPointInOrOnPolygon(b, outline)) violations.add(`outline:${i}`)
      for (let edge = 0; edge < outline.length; edge++) if (minimumDistanceBetweenSegments(a, b,
        outline[edge]!, outline[(edge + 1) % outline.length]!) < margin - 1e-8) violations.add(`outline:${i}`)
    }
    return violations
  }
  const baselineEdges = externalViolations(vertices)
  for (const key of baselineEdges) {
    const primitive = primitives[Number(key.split(":")[1])]!
    vertices[primitive.a]!.fixed = true
    vertices[primitive.b]!.fixed = true
  }
  // Only local obstacles can be reached: every moved vertex is projected back
  // into this node and a segment between such vertices remains in its rectangle.
  const bounds = { minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 }
  const reach = Math.max(clearance, params.minTraceToHoleEdgeClearance ?? clearance,
    params.minTraceToPadEdgeClearance ?? clearance, params.viaToPadClearance ?? clearance) + Math.max(...primitives.map((primitive) => primitive.radius),
    (params.viaHoleDiameter ?? 0) / 2 + (params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0))
  const obstacles = (params.obstacles ?? []).filter((obstacle) => {
    const halfDiagonal = Math.hypot(obstacle.width, obstacle.height) / 2 + reach
    return obstacle.center.x + halfDiagonal >= bounds.minX && obstacle.center.x - halfDiagonal <= bounds.maxX &&
      obstacle.center.y + halfDiagonal >= bounds.minY && obstacle.center.y - halfDiagonal <= bounds.maxY
  }).map((obstacle) => ({ obstacle,
    traceClearance: obstacle.isNonPlatedHole ? params.minTraceToHoleEdgeClearance ?? clearance : params.minTraceToPadEdgeClearance ?? clearance,
    viaClearance: obstacle.isNonPlatedHole ? params.minTraceToHoleEdgeClearance ?? clearance : params.viaToPadClearance ?? clearance,
    layers: obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)),
    connected: routes.map((route) => obstacle.connectedTo.some((id) => id === route.connectionName || id === route.rootConnectionName ||
      connMap?.areIdsConnected(id, route.connectionName) || route.rootConnectionName !== undefined && connMap?.areIdsConnected(id, route.rootConnectionName))) }))
  const obstacleBounds = new Map(obstacles.map(({ obstacle }) => {
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const hx = obstacle.shape === "circle" ? Math.max(obstacle.width, obstacle.height) / 2
      : (Math.abs(Math.cos(angle)) * obstacle.width + Math.abs(Math.sin(angle)) * obstacle.height) / 2
    const hy = obstacle.shape === "circle" ? Math.max(obstacle.width, obstacle.height) / 2
      : (Math.abs(Math.sin(angle)) * obstacle.width + Math.abs(Math.cos(angle)) * obstacle.height) / 2
    return [obstacle, { minX: obstacle.center.x - hx, maxX: obstacle.center.x + hx,
      minY: obstacle.center.y - hy, maxY: obstacle.center.y + hy }] as const
  }))
  const primitiveNearObstacle = (primitive: Primitive, obstacle: Obstacle, margin: number): boolean => {
    const rect = obstacleBounds.get(obstacle)!
    const a = vertices[primitive.a]!, b = vertices[primitive.b]!
    margin = Math.max(0, margin)
    return Math.min(a.x, b.x) - margin <= rect.maxX && Math.max(a.x, b.x) + margin >= rect.minX &&
      Math.min(a.y, b.y) - margin <= rect.maxY && Math.max(a.y, b.y) + margin >= rect.minY
  }
  let geometryWork = 0
  let energyEvaluationCount = 0
  const obstacleContact = (primitive: Primitive, obstacle: Obstacle): Contact => {
    geometryWork += obstacle.shape === "circle" ? 1 : 4
    const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const cosine = Math.cos(angle), sine = Math.sin(angle)
    const local = (point: Point): Point => ({ x: cosine * (point.x - obstacle.center.x) - sine * (point.y - obstacle.center.y),
      y: sine * (point.x - obstacle.center.x) + cosine * (point.y - obstacle.center.y) })
    const a = local(vertices[primitive.a]!), b = local(vertices[primitive.b]!)
    if (obstacle.shape === "circle") {
      const contact = closestSegments(a, b, { x: 0, y: 0 }, { x: 0, y: 0 })
      return { ...contact, dx: cosine * contact.dx + sine * contact.dy, dy: -sine * contact.dx + cosine * contact.dy,
        distance: contact.distance - Math.max(obstacle.width, obstacle.height) / 2 }
    }
    const hx = obstacle.width / 2, hy = obstacle.height / 2
    const corners = [{ x: -hx, y: -hy }, { x: hx, y: -hy }, { x: hx, y: hy }, { x: -hx, y: hy }]
    let best: Contact | undefined
    for (let i = 0; i < 4; i++) {
      const contact = closestSegments(a, b, corners[i]!, corners[(i + 1) % 4]!)
      if (!best || contact.distance < best.distance) best = contact
    }
    if (!best) throw new Error("Physical legalization rectangle has no edges")
    for (const [t, point] of [[0, a], [1, b]] as const) {
      if (Math.abs(point.x) >= hx || Math.abs(point.y) >= hy) continue
      const dx = hx - Math.abs(point.x), dy = hy - Math.abs(point.y)
      const depth = Math.min(dx, dy)
      if (-depth < best.distance) best = { t, u: 0, distance: -depth,
        dx: dx < dy ? Math.sign(point.x) || 1 : 0, dy: dx < dy ? 0 : Math.sign(point.y) || 1 }
    }
    if (best.distance < 1e-12 && Math.hypot(best.dx, best.dy) < 1e-12) {
      const x = a.x + best.t * (b.x - a.x), y = a.y + best.t * (b.y - a.y)
      if (hx - Math.abs(x) < hy - Math.abs(y)) best.dx = Math.sign(x) || 1
      else best.dy = Math.sign(y) || 1
    }
    return { ...best, dx: cosine * best.dx + sine * best.dy, dy: -sine * best.dx + cosine * best.dy }
  }
  const obstacleConstraints: { primitive: Primitive; obstacle: Obstacle; minimumDistance: number }[] = []
  const holeConstraints: { a: number; b: number; minimumDistance: number }[] = []
  if (params.viaHoleDiameter !== undefined) {
    const required = params.viaHoleDiameter + (params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0)
    const vias = primitives.filter((primitive) => primitive.via)
    for (let i = 0; i < vias.length; i++) for (let j = i + 1; j < vias.length; j++) {
      const left = vias[i]!, right = vias[j]!
      if (left.a === right.a || left.minZ > right.maxZ || right.minZ > left.maxZ) continue
      const a = vertices[left.a]!, b = vertices[right.a]!
      holeConstraints.push({ a: left.a, b: right.a, minimumDistance: Math.min(required, Math.hypot(a.x - b.x, a.y - b.y)) })
    }
  }
  const obstaclePenetrationByRoute = obstacles.map(() => routes.map(() => 0))
  for (const primitive of primitives) for (const [obstacleIndex, entry] of obstacles.entries()) {
    if (entry.connected[primitive.routeIndex] && !primitive.via || !entry.layers.some((z) => z >= primitive.minZ && z <= primitive.maxZ)) continue
    const gap = primitive.via ? entry.viaClearance : entry.traceClearance
    if (!primitiveNearObstacle(primitive, entry.obstacle, primitive.radius + gap)) continue
    const penetration = Math.max(0, primitive.radius + gap - obstacleContact(primitive, entry.obstacle).distance)
    obstaclePenetrationByRoute[obstacleIndex]![primitive.routeIndex] = Math.max(
      obstaclePenetrationByRoute[obstacleIndex]![primitive.routeIndex]!, penetration)
  }
  for (const primitive of primitives) for (const [obstacleIndex, entry] of obstacles.entries()) {
    if (entry.connected[primitive.routeIndex] && !primitive.via || !entry.layers.some((z) => z >= primitive.minZ && z <= primitive.maxZ)) continue
    const required = primitive.radius + (primitive.via ? entry.viaClearance : entry.traceClearance)
    obstacleConstraints.push({ primitive, obstacle: entry.obstacle,
      minimumDistance: required - obstaclePenetrationByRoute[obstacleIndex]![primitive.routeIndex]! })
  }
  const preservesObstacleClearance = (): boolean => {
    for (const constraint of obstacleConstraints) {
      if (!primitiveNearObstacle(constraint.primitive, constraint.obstacle, constraint.minimumDistance)) continue
      const distance = obstacleContact(constraint.primitive, constraint.obstacle).distance
      if (distance < constraint.minimumDistance - 1e-8) return false
    }
    return true
  }
  const preservesHoleClearance = (): boolean => {
    for (const constraint of holeConstraints) {
      geometryWork++
      const a = vertices[constraint.a]!, b = vertices[constraint.b]!
      if (Math.hypot(a.x - b.x, a.y - b.y) < constraint.minimumDistance - 1e-8) return false
    }
    return true
  }
  // Objective-only backtracking evaluations do not need fresh force arrays.
  // Reuse one workspace; only gradient evaluations clear or update it.
  const gx = new Float64Array(vertices.length)
  const gy = new Float64Array(vertices.length)
  const weight = new Float64Array(vertices.length)
  const energy = (gradient: boolean): Energy => {
    energyEvaluationCount++
    geometryWork += primitives.length
    if (gradient) { gx.fill(0); gy.fill(0); weight.fill(0) }
    const result: Energy = { loss: 0, maxPenetration: 0, pairs: 0, movableLoss: 0, movableContacts: 0, gx, gy, weight }
    const index = new Flatbush(primitives.length)
    for (const primitive of primitives) {
      const a = vertices[primitive.a]!, b = vertices[primitive.b]!
      const radius = Math.max(primitive.radius + clearance,
        (params.viaHoleDiameter ?? 0) + (params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0))
      index.add(Math.min(a.x, b.x) - radius, Math.min(a.y, b.y) - radius, Math.max(a.x, b.x) + radius, Math.max(a.y, b.y) + radius)
    }
    index.finish()
    const addContact = (left: Primitive, right: Primitive | undefined, contact: Contact, required: number): void => {
      const penetration = required + 1e-6 - contact.distance
      if (penetration <= 1e-8) return
      result.loss += penetration * penetration
      result.maxPenetration = Math.max(result.maxPenetration, penetration)
      result.pairs++
      const movable = !vertices[left.a]!.fixed && 1 - contact.t > 1e-9 || !vertices[left.b]!.fixed && contact.t > 1e-9 ||
        right !== undefined && (!vertices[right.a]!.fixed && 1 - contact.u > 1e-9 || !vertices[right.b]!.fixed && contact.u > 1e-9)
      if (movable) { result.movableLoss += penetration * penetration; result.movableContacts++ }
      if (!gradient) return
      let { dx, dy } = contact
      let magnitude = Math.hypot(dx, dy)
      if (magnitude < 1e-12) {
        const a = vertices[left.a]!, b = vertices[left.b]!
        dx = -(b.y - a.y); dy = b.x - a.x
        magnitude = Math.hypot(dx, dy)
        if (magnitude < 1e-12) { dx = 1; dy = 0; magnitude = 1 }
      }
      dx *= penetration / magnitude; dy *= penetration / magnitude
      const add = (vertex: number, weight: number): void => {
        if (!vertices[vertex]!.fixed) {
          result.gx[vertex]! += dx * weight; result.gy[vertex]! += dy * weight
          result.weight[vertex]! += weight * weight
        }
      }
      add(left.a, 1 - contact.t); add(left.b, contact.t)
      if (right) { add(right.a, -(1 - contact.u)); add(right.b, -contact.u) }
    }
    for (const [i, left] of primitives.entries()) {
      const a = vertices[left.a]!, b = vertices[left.b]!, radius = left.radius
      for (const j of index.search(Math.min(a.x, b.x) - radius, Math.min(a.y, b.y) - radius,
        Math.max(a.x, b.x) + radius, Math.max(a.y, b.y) + radius)) {
        if (j <= i) continue
        const right = primitives[j]!
        if (left.minZ > right.maxZ || right.minZ > left.maxZ) continue
        const sameOwner = sameNet[left.routeIndex]![right.routeIndex]
        const holeDistance = left.via && right.via && params.viaHoleDiameter !== undefined
          ? params.viaHoleDiameter + (params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0) : 0
        if (sameOwner && (holeDistance === 0 || left.a === right.a || !left.via || !right.via)) continue
        geometryWork++
        addContact(left, right, closestSegments(a, b, vertices[right.a]!, vertices[right.b]!),
          sameOwner ? holeDistance : Math.max(holeDistance, left.radius + right.radius + clearance))
      }
      for (const entry of obstacles) {
        if (entry.connected[left.routeIndex] && !left.via || !entry.layers.some((z) => z >= left.minZ && z <= left.maxZ)) continue
        const gap = left.via ? entry.viaClearance : entry.traceClearance
        if (!primitiveNearObstacle(left, entry.obstacle, left.radius + gap)) continue
        addContact(left, undefined, obstacleContact(left, entry.obstacle), left.radius + gap)
      }
    }
    return result
  }
  const initial = energy(false)
  let current = initial
  let bestLoss = initial.loss
  let bestPositions = vertices.map(({ x, y }) => ({ x, y }))
  let iterations = 0
  const maxMove = Math.max(0.005, Math.min(0.06, Math.min(node.width, node.height) / 20))
  const maxIterations = params.maxIterations ?? 40
  if (!Number.isInteger(maxIterations) || maxIterations < 0) throw new Error("Physical legalization iterations must be a nonnegative integer")
  if (params.projectionWorkLimit !== undefined && (!Number.isFinite(params.projectionWorkLimit) || params.projectionWorkLimit < 0)) {
    throw new Error("Physical legalization work limit must be finite and nonnegative")
  }
  const projectionStartWork = geometryWork
  const projectionWorkLimit = mode === "selective" ? params.projectionWorkLimit ??
    Math.max(10_000, geometryWork * Math.max(8, maxIterations * 4)) : Infinity
  let stopReason: PhysicalRouteLegalizationResult["stopReason"] = "iteration-limit"
  let checkpointMovableLoss = initial.movableLoss
  const eligible = mode !== "selective" || initial.movableContacts > 0
  if (!eligible) stopReason = "no-movable-conflicts"
  for (; eligible && iterations < maxIterations && current.loss > 1e-14; iterations++) {
    if (mode === "selective" && geometryWork - projectionStartWork >= projectionWorkLimit) { stopReason = "work-limit"; break }
    if (mode === "selective" && current.movableContacts === 0) { stopReason = "no-movable-conflicts"; break }
    if (mode === "selective" && iterations > 0 && iterations % 4 === 0) {
      const relativeProgress = (checkpointMovableLoss - current.movableLoss) / Math.max(checkpointMovableLoss, 1e-12)
      if (relativeProgress < 0.005) { stopReason = "progress-plateau"; break }
      checkpointMovableLoss = current.movableLoss
    }
    const forces = energy(true)
    const previous = vertices.map(({ x, y }) => ({ x, y }))
    const moves = vertices.map((vertex, i) => {
      const normalizer = Math.max(1, forces.weight[i]!)
      let x = vertex.fixed ? 0 : forces.gx[i]! / normalizer
      let y = vertex.fixed ? 0 : forces.gy[i]! / normalizer
      const length = Math.hypot(x, y)
      if (length > maxMove) { x *= maxMove / length; y *= maxMove / length }
      return { x, y }
    })
    // Contacts stay fixed while projecting this iteration's displacement. Cache
    // their half-spaces once, then solve both families together: a hole update
    // can otherwise invalidate a pad constraint projected earlier in the pass.
    const halfSpaces: ProjectionHalfSpace[] = []
    for (const constraint of obstacleConstraints) {
      const { primitive, obstacle, minimumDistance } = constraint
      if (!primitiveNearObstacle(primitive, obstacle, minimumDistance + maxMove * 3)) continue
      const contact = obstacleContact(primitive, obstacle)
      if (contact.distance - minimumDistance > maxMove * 3) continue
      const magnitude = Math.hypot(contact.dx, contact.dy)
      if (magnitude < 1e-12) continue
      const wa = vertices[primitive.a]!.fixed ? 0 : 1 - contact.t
      const wb = vertices[primitive.b]!.fixed ? 0 : contact.t
      const denominator = primitive.a === primitive.b ? (wa + wb) ** 2 : wa * wa + wb * wb
      if (denominator < 1e-12) continue
      halfSpaces.push({ a: primitive.a, b: primitive.b, nx: contact.dx / magnitude,
        ny: contact.dy / magnitude, wa, wb, denominator,
        minimumMotion: minimumDistance - contact.distance, kind: "obstacle" })
    }
    for (const constraint of holeConstraints) {
      geometryWork++
      const a = vertices[constraint.a]!, b = vertices[constraint.b]!
      const dx = a.x - b.x, dy = a.y - b.y, distance = Math.hypot(dx, dy)
      if (distance < 1e-12 || distance - constraint.minimumDistance > maxMove * 3) continue
      const wa = Number(!a.fixed), wb = Number(!b.fixed)
      if (wa + wb === 0) continue
      halfSpaces.push({ a: constraint.a, b: constraint.b, nx: dx / distance, ny: dy / distance,
        wa, wb, denominator: wa + wb,
        minimumMotion: constraint.minimumDistance - distance, kind: "hole" })
    }
    for (let pass = 0; pass < 32; pass++) {
      let largestAdjustment = 0
      for (const constraint of halfSpaces) {
        geometryWork++
        const { nx, ny, wa, wb, denominator } = constraint
        const moveA = moves[constraint.a]!, moveB = moves[constraint.b]!
        const motion = constraint.kind === "obstacle"
          ? nx * (wa * moveA.x + wb * moveB.x) + ny * (wa * moveA.y + wb * moveB.y)
          : nx * (moveA.x - moveB.x) + ny * (moveA.y - moveB.y)
        const correction = constraint.minimumMotion - motion
        if (correction <= 0) continue
        const ax = nx * correction * wa / denominator, ay = ny * correction * wa / denominator
        const bx = nx * correction * wb / denominator, by = ny * correction * wb / denominator
        moveA.x += ax; moveA.y += ay
        moveB.x += constraint.kind === "obstacle" ? bx : -bx
        moveB.y += constraint.kind === "obstacle" ? by : -by
        largestAdjustment = Math.max(largestAdjustment, Math.hypot(ax, ay) + Math.hypot(bx, by))
      }
      if (largestAdjustment < 1e-12) break
    }
    let accepted = false
    for (const step of [1, 0.5, 0.25, 0.125, 0.0625, 0.03125]) {
      for (const [i, vertex] of vertices.entries()) {
        if (vertex.fixed) continue
        const dx = moves[i]!.x, dy = moves[i]!.y
        const inset = Math.min(vertex.radius, node.width / 2, node.height / 2)
        // Grown copper may already touch a capacity boundary. Include its
        // starting position so smaller steps do not force a fixed-size jump.
        // Exact board, obstacle and drill guards still decide acceptance.
        vertex.x = Math.max(Math.min(bounds.minX + inset, vertex.originalX),
          Math.min(Math.max(bounds.maxX - inset, vertex.originalX), previous[i]!.x + step * dx))
        vertex.y = Math.max(Math.min(bounds.minY + inset, vertex.originalY),
          Math.min(Math.max(bounds.maxY - inset, vertex.originalY), previous[i]!.y + step * dy))
      }
      const candidate = energy(false)
      if (candidate.loss < current.loss - 1e-14 && preservesObstacleClearance() && preservesHoleClearance()) { current = candidate; accepted = true; break }
    }
    if (!accepted) {
      for (const [i, vertex] of vertices.entries()) { vertex.x = previous[i]!.x; vertex.y = previous[i]!.y }
      stopReason = "no-descent"
      break
    }
    if (current.loss < bestLoss) {
      bestLoss = current.loss
      bestPositions = vertices.map(({ x, y }) => ({ x, y }))
    }
  }
  if (current.loss <= 1e-14) stopReason = "clean-energy"
  const projectionWork = geometryWork - projectionStartWork
  for (const [i, vertex] of vertices.entries()) { vertex.x = bestPositions[i]!.x; vertex.y = bestPositions[i]!.y }
  const candidate = routes.map((route, routeIndex) => ({ ...route,
    route: route.route.map((point, i) => ({ ...point, x: vertices[routeVertices[routeIndex]![i]!]!.x,
      y: vertices[routeVertices[routeIndex]![i]!]!.y })),
    vias: route.vias.map((via) => {
      const index = vertexByOwnerXY.get(xyKey(routeIndex, via))
      if (index === undefined) throw new Error(`Physical legalization lost a via for ${route.connectionName}`)
      return { x: vertices[index]!.x, y: vertices[index]!.y }
    }),
  }))
  const copperPairsAfter = pairCount(candidate, clearance), overlapPairsAfter = pairCount(candidate, 0)
  const holePairsAfter = holePairCount(candidate)
  // Transactional guard: never trade a newly hit board obstacle/edge for a local
  // pair improvement. Check independent of the optimizer's broad phase/energy.
  const finalEdges = externalViolations(vertices)
  // This separately checks exact rectangle/circle distances against the
  // original physical route/obstacle pair's worst penetration. Clean pairs
  // must remain clean; an existing access conflict cannot become deeper.
  const obstacleWorsened = !preservesObstacleClearance()
  const accepted = bestLoss < initial.loss - 1e-12 && overlapPairsAfter <= overlapPairsBefore &&
    (holePairsBefore === null || holePairsAfter !== null && holePairsAfter <= holePairsBefore) &&
    !obstacleWorsened && preservesHoleClearance() && [...finalEdges].every((key) => baselineEdges.has(key))
  const acceptedRoutes = accepted ? candidate : routes
  const finalPairs = accepted ? copperPairsAfter : copperPairsBefore
  const independentCleanCheckPassed = finalPairs === 0 && accepted && isPhysicalProposalClean({ ...params, routes: acceptedRoutes })
  return { routes: acceptedRoutes, mode, metricsRecorded: true, stopReason, status: independentCleanCheckPassed
      ? "clean" : accepted ? "improved-needs-repair" : "unchanged-needs-repair",
    elapsedMs: performance.now() - startedAt, iterations, pointsBefore,
    pointsAfter: acceptedRoutes.reduce((sum, route) => sum + route.route.length, 0),
    copperPairsBefore, copperPairsAfter: finalPairs, overlapPairsBefore,
    overlapPairsAfter: accepted ? overlapPairsAfter : overlapPairsBefore,
    holePairsBefore, holePairsAfter: accepted ? holePairsAfter : holePairsBefore,
    lossBefore: initial.loss, lossAfter: accepted ? bestLoss : initial.loss,
    energyEvaluationCount, geometryWork, projectionWork, projectionWorkLimit: Number.isFinite(projectionWorkLimit) ? projectionWorkLimit : null,
    movableConflictCount: initial.movableContacts, immutableConflictCount: initial.pairs - initial.movableContacts, energyMetricsRecorded: true,
    drillMetricsRecorded: holePairsBefore !== null,
    independentCleanScope: independentCleanCheckPassed ? holePairsAfter === null ? "copper-only" : "copper-and-drill" : null,
    movableLossBefore: initial.movableLoss, movableLossAfter: accepted ? current.movableLoss : initial.movableLoss,
    candidateLoss: bestLoss, candidateCopperPairs: copperPairsAfter, candidateOverlapPairs: overlapPairsAfter,
    obstacleGuardRejected: obstacleWorsened, boardGuardRejected: [...finalEdges].some((key) => !baselineEdges.has(key)),
    independentCleanCheckPassed }
}
