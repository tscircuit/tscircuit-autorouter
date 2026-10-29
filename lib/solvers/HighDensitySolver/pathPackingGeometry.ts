import { segmentToBoundsMinDistance, segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export type PathPackingAudit = {
  requested: true
  activated: boolean
  eligibleNodes: number
  instances: number
  nativeDistinctCandidates: number
  bankTasks: number
  generatedCandidates: number
  distinctCandidates: number
  distinctViaPatterns: number
  generationSearchNodes: number
  unaryChecks: number
  pairChecks: number
  selectionStates: number
  solvedNodes: number
  workUnits: number
  exhaustedNodes: number
}

export const createPathPackingAudit = (): PathPackingAudit => ({
  requested: true, activated: false, eligibleNodes: 0, instances: 0, nativeDistinctCandidates: 0,
  bankTasks: 0, generatedCandidates: 0, distinctCandidates: 0,
  distinctViaPatterns: 0, generationSearchNodes: 0, unaryChecks: 0,
  pairChecks: 0, selectionStates: 0, solvedNodes: 0, workUnits: 0,
  exhaustedNodes: 0,
})

export type PackingTask = {
  connectionName: string
  rootConnectionName?: string
  points: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }]
}

export type PackingGeometryParams = {
  node: NodeWithPortPoints
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
  boardGeometry?: HighDensityBoardGeometry
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  traceClearance: number
  viaToPadClearance: number
  holeClearance: number
  viaHoleDiameter: number
  minimumHoleGap: number
}

/** Every body intersecting any possible in-node capsule survives this crop. */
export function* preparePathPackingObstacles(
  node: NodeWithPortPoints, obstacles: readonly Obstacle[], traceWidth: number,
  viaDiameter: number, maximumClearance: number,
): Generator<void, Obstacle[]> {
  const result: Obstacle[] = []
  const reach = Math.max(traceWidth, viaDiameter) / 2 + maximumClearance + 1e-9
  if (![traceWidth, viaDiameter, maximumClearance, reach].every(Number.isFinite) ||
    traceWidth <= 0 || viaDiameter <= 0 || maximumClearance < 0)
    throw new Error("Invalid path packing crop geometry")
  for (const obstacle of obstacles) {
    yield
    if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height,
      obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) || obstacle.width < 0 || obstacle.height < 0)
      throw new Error("Invalid path packing obstacle geometry")
    const radius = Math.hypot(obstacle.width, obstacle.height) / 2 + reach
    if (obstacle.center.x + radius >= node.center.x - node.width / 2 &&
      obstacle.center.x - radius <= node.center.x + node.width / 2 &&
      obstacle.center.y + radius >= node.center.y - node.height / 2 &&
      obstacle.center.y - radius <= node.center.y + node.height / 2) result.push(obstacle)
  }
  return result
}

type Point = { x: number; y: number }
const EPS = 1e-9

function obstacleDistance(a: Point, b: Point, obstacle: Obstacle): number {
  if (obstacle.isNonPlatedHole && obstacle.shape === "circle")
    return Math.max(0, segmentToSegmentMinDistance(a, b, { x: 0, y: 0 }, { x: 0, y: 0 }) - Math.max(obstacle.width, obstacle.height) / 2)
  if (obstacle.type === "rect") return segmentToBoundsMinDistance(a, b, {
    minX: -obstacle.width / 2, maxX: obstacle.width / 2,
    minY: -obstacle.height / 2, maxY: obstacle.height / 2,
  })
  if (obstacle.type !== "oval") throw new Error("Unsupported path-packing obstacle body")
  const half = Math.abs(obstacle.width - obstacle.height) / 2
  const dx = obstacle.width >= obstacle.height ? half : 0
  const dy = obstacle.height > obstacle.width ? half : 0
  return Math.max(0, segmentToSegmentMinDistance(a, b, { x: -dx, y: -dy }, { x: dx, y: dy }) - Math.min(obstacle.width, obstacle.height) / 2)
}

function pointInside(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside
  }
  return inside
}

/** Exact continuous capsule checks; no proximity ever changes net ownership. */
export class PathPackingGeometry {
  constructor(readonly params: PackingGeometryParams, readonly audit: PathPackingAudit) {
    const { node } = params
    if (![node.center.x, node.center.y, node.width, node.height,
      params.traceClearance, params.viaToPadClearance, params.holeClearance,
      params.viaHoleDiameter, params.minimumHoleGap].every(Number.isFinite) ||
      node.width <= 0 || node.height <= 0 || params.viaHoleDiameter <= 0 ||
      [params.traceClearance, params.viaToPadClearance, params.holeClearance, params.minimumHoleGap].some((n) => n < 0) ||
      !Number.isSafeInteger(params.layerCount) || params.layerCount < 1)
      throw new Error("Invalid path packing physical context")
    if (params.boardGeometry &&
      !Object.values(params.boardGeometry.bounds).every(Number.isFinite))
      throw new Error("Invalid path packing board bounds")
  }

  sameOwner(a: HighDensityRoute, b: HighDensityRoute): boolean {
    return a.connectionName === b.connectionName ||
      (a.rootConnectionName !== undefined && a.rootConnectionName === b.rootConnectionName) ||
      this.params.connMap?.areIdsConnected(a.connectionName, b.connectionName) === true
  }

  private *boardClear(a: Point, b: Point, radius: number): Generator<void, boolean> {
    const board = this.params.boardGeometry
    if (!board) return true
    const margin = radius + (board.minBoardEdgeClearance ?? 0)
    const { bounds } = board
    yield
    if (Math.min(a.x, b.x) - margin < bounds.minX - EPS ||
      Math.max(a.x, b.x) + margin > bounds.maxX + EPS ||
      Math.min(a.y, b.y) - margin < bounds.minY - EPS ||
      Math.max(a.y, b.y) + margin > bounds.maxY + EPS) return false
    const outline = board.outline
    if (!outline?.length) return true
    if (outline.length < 3) throw new Error("Path packing requires a valid board outline")
    yield
    if (!pointInside(a, outline) || !pointInside(b, outline)) return false
    for (let i = 0; i < outline.length; i++) {
      yield
      if (segmentToSegmentMinDistance(a, b, outline[i]!, outline[(i + 1) % outline.length]!) + EPS < margin)
        return false
    }
    return true
  }

  private connected(route: HighDensityRoute, obstacle: Obstacle): boolean {
    if (obstacle.isNonPlatedHole) return false
    return obstacle.connectedTo.some((id) => id === route.connectionName ||
      id === route.rootConnectionName ||
      this.params.connMap?.areIdsConnected(id, route.connectionName) === true)
  }

  private *obstacleClear(route: HighDensityRoute, a: Point, b: Point,
    minZ: number, maxZ: number, radius: number, via: boolean): Generator<void, boolean> {
    for (const obstacle of this.params.obstacles) {
      yield
      if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height,
        obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) || obstacle.width < 0 || obstacle.height < 0)
        throw new Error("Invalid path packing obstacle geometry")
      if (this.connected(route, obstacle)) continue
      const layers = obstacle.isNonPlatedHole
        ? Array.from({ length: this.params.layerCount }, (_, i) => i)
        : (obstacle.zLayers ?? obstacle.layers.map((z) => mapLayerNameToZ(z, this.params.layerCount)))
      if (!layers.some((z) => z >= minZ && z <= maxZ)) continue
      const gap = obstacle.isNonPlatedHole ? this.params.holeClearance :
        via ? this.params.viaToPadClearance : this.params.traceClearance
      const reach = radius + gap
      const extent = Math.hypot(obstacle.width, obstacle.height) / 2
      if (Math.max(a.x, b.x) + reach < obstacle.center.x - extent ||
        Math.min(a.x, b.x) - reach > obstacle.center.x + extent ||
        Math.max(a.y, b.y) + reach < obstacle.center.y - extent ||
        Math.min(a.y, b.y) - reach > obstacle.center.y + extent) continue
      const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const c = Math.cos(angle), s = Math.sin(angle)
      const local = (p: Point): Point => ({
        x: (p.x - obstacle.center.x) * c + (p.y - obstacle.center.y) * s,
        y: -(p.x - obstacle.center.x) * s + (p.y - obstacle.center.y) * c,
      })
      // Rectangles conservatively include legacy inferred round pad copper;
      // explicit NPTH circles/ovals retain their exact physical body.
      yield
      if (obstacleDistance(local(a), local(b), obstacle) + EPS < reach) return false
    }
    return true
  }

  *unary(route: HighDensityRoute, task: PackingTask): Generator<void, boolean> {
    this.audit.unaryChecks++
    const { node, layerCount } = this.params
    const available = new Set(node.availableZ ?? Array.from({ length: layerCount }, (_, i) => i))
    const first = route.route[0], last = route.route.at(-1)
    yield
    if (!first || !last || route.connectionName !== task.connectionName ||
      first.x !== task.points[0].x || first.y !== task.points[0].y || first.z !== task.points[0].z ||
      last.x !== task.points[1].x || last.y !== task.points[1].y || last.z !== task.points[1].z) return false
    if (!Number.isFinite(route.traceThickness) || !Number.isFinite(route.viaDiameter) ||
      !(route.traceThickness > 0) || !(route.viaDiameter >= this.params.viaHoleDiameter)) return false
    const expectedVias = new Set<string>()
    for (let i = 0; i < route.route.length; i++) {
      const p = route.route[i]!
      yield
      if (![p.x, p.y, p.z].every(Number.isFinite) || !Number.isSafeInteger(p.z) ||
        !available.has(p.z) || Math.abs(p.x - node.center.x) > node.width / 2 + EPS ||
        Math.abs(p.y - node.center.y) > node.height / 2 + EPS) return false
      if (i > 0) {
        const before = route.route[i - 1]!
        if (p.z !== before.z && (p.x !== before.x || p.y !== before.y)) return false
        if (p.z !== before.z) expectedVias.add(JSON.stringify([p.x, p.y]))
      }
    }
    const actualVias = new Set<string>()
    for (const via of route.vias) {
      yield
      if (![via.x, via.y].every(Number.isFinite)) return false
      actualVias.add(JSON.stringify([via.x, via.y]))
    }
    if (expectedVias.size !== actualVias.size || [...expectedVias].some((v) => !actualVias.has(v))) return false
    const geometry = getPipeline9RouteCopperGeometry(route, this.params)
    for (const wire of geometry.wireSegments) {
      yield
      if (!(yield* this.boardClear(wire.start, wire.end, wire.width / 2)) ||
        !(yield* this.obstacleClear(route, wire.start, wire.end, wire.z, wire.z, wire.width / 2, false))) return false
    }
    for (const via of geometry.viaSpans) {
      yield
      if (![via.center.x, via.center.y, via.diameter, via.minZ, via.maxZ].every(Number.isFinite)) return false
      if (via.center.x - via.diameter / 2 < node.center.x - node.width / 2 - EPS ||
        via.center.x + via.diameter / 2 > node.center.x + node.width / 2 + EPS ||
        via.center.y - via.diameter / 2 < node.center.y - node.height / 2 - EPS ||
        via.center.y + via.diameter / 2 > node.center.y + node.height / 2 + EPS ||
        !(yield* this.boardClear(via.center, via.center, via.diameter / 2)) ||
        !(yield* this.obstacleClear(route, via.center, via.center, via.minZ, via.maxZ, via.diameter / 2, true))) return false
    }
    for (let i = 0; i < geometry.viaSpans.length; i++)
      for (let j = i + 1; j < geometry.viaSpans.length; j++) {
        yield
        const a = geometry.viaSpans[i]!.center, b = geometry.viaSpans[j]!.center
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (distance > 0 && distance + EPS < Math.max(
          this.params.viaHoleDiameter + this.params.minimumHoleGap,
          route.viaDiameter + this.params.traceClearance)) return false
      }
    return true
  }

  *conflict(a: HighDensityRoute, b: HighDensityRoute): Generator<void, boolean> {
    this.audit.pairChecks++
    const x = getPipeline9RouteCopperGeometry(a, this.params), y = getPipeline9RouteCopperGeometry(b, this.params)
    const same = this.sameOwner(a, b)
    for (const va of x.viaSpans) for (const vb of y.viaSpans) {
      yield
      const distance = Math.hypot(va.center.x - vb.center.x, va.center.y - vb.center.y)
      if (!(distance === 0 && same) && distance + EPS < this.params.viaHoleDiameter + this.params.minimumHoleGap) return true
      if (!(distance === 0 && same) &&
        distance + EPS < (va.diameter + vb.diameter) / 2 + this.params.traceClearance) return true
    }
    if (same) return false
    for (const wa of x.wireSegments) for (const wb of y.wireSegments) {
      yield
      if (wa.z === wb.z && segmentToSegmentMinDistance(wa.start, wa.end, wb.start, wb.end) + EPS <
        (wa.width + wb.width) / 2 + this.params.traceClearance) return true
    }
    for (const [vias, wires] of [[x.viaSpans, y.wireSegments], [y.viaSpans, x.wireSegments]] as const)
      for (const via of vias) for (const wire of wires) {
        yield
        if (wire.z >= via.minZ && wire.z <= via.maxZ &&
          segmentToSegmentMinDistance(via.center, via.center, wire.start, wire.end) + EPS <
          (via.diameter + wire.width) / 2 + this.params.traceClearance) return true
      }
    return false
  }
}
