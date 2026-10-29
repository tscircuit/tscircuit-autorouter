import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { segmentToBoundsMinDistance, segmentToCircleMinDistance } from "@tscircuit/math-utils"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "./pipeline9FixedRouteCopper"

type Section = { points: HighDensityRoute["route"]; z: number; locked: boolean }
type Variant = { route: HighDensityRoute; sites: number }
type CachedVariant = Variant & { staticConflict: boolean }
type Entry = { index: number; sections: Section[]; layers: number[] }
type StaticBounds = { minX: number; minY: number; maxX: number; maxY: number }
type StaticObstacle = {
  obstacle: Obstacle; cosine: number; sine: number
  bounds: StaticBounds; layers: Set<string>
}
const MAX_CACHED_VARIANTS = 1024
const MAX_CACHED_PAIRS = 32768
const MAX_CACHED_STATIC_OWNERS = 1024
export type JointLayerAssignmentParams = {
  routes: HighDensityRoute[]
  fixedRoutes: HighDensityRoute[]
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  connMap: ConnectivityMap
  clearance: number
  obstacles?: Obstacle[]
  viaToPadClearance?: number
  evaluate: (routes: HighDensityRoute[]) => {
    valid: boolean
    manufacturedSites: number
  }
  maxSearchStates?: number
}

/** Bounded joint layer assignment: XY, widths, terminals and existing drill sites stay fixed. */
export class Pipeline9JointLayerAssignmentSolver extends BaseSolver {
  readonly params: JointLayerAssignmentParams
  bestRoutes: HighDensityRoute[]
  private readonly entries: Entry[] = []
  private readonly groups: Entry[][] = []
  private groupIndex = 0
  private readonly maxSearchStates: number
  private bestSites = 0
  private readonly routeBounds = new WeakMap<HighDensityRoute, number[]>()
  private readonly routeIdentities = new WeakMap<HighDensityRoute, number>()
  private nextRouteIdentity = 0
  private readonly variantCache = new Map<string, CachedVariant>()
  private readonly pairConflictCache = new Map<string, boolean>()
  private readonly staticObstacles: StaticObstacle[]
  private readonly staticObstaclesByOwner = new Map<string, StaticObstacle[]>()

  constructor(params: JointLayerAssignmentParams) {
    super()
    this.params = params
    this.staticObstacles = (params.obstacles ?? []).map((obstacle) => {
      const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const cosine = Math.cos(angle), sine = Math.sin(angle)
      const radius = Math.max(obstacle.width, obstacle.height) / 2
      const dx = obstacle.shape === "circle" ? Math.abs(radius) :
        Math.abs(cosine * obstacle.width / 2) + Math.abs(sine * obstacle.height / 2)
      const dy = obstacle.shape === "circle" ? Math.abs(radius) :
        Math.abs(sine * obstacle.width / 2) + Math.abs(cosine * obstacle.height / 2)
      const guard = 1e-9 + 16 * Number.EPSILON * Math.max(1,
        Math.abs(obstacle.center.x), Math.abs(obstacle.center.y), dx, dy)
      return { obstacle, cosine, sine, layers: new Set(obstacle.layers),
        bounds: { minX: obstacle.center.x - dx - guard, minY: obstacle.center.y - dy - guard,
          maxX: obstacle.center.x + dx + guard, maxY: obstacle.center.y + dy + guard } }
    })
    this.bestRoutes = params.routes
    this.maxSearchStates = params.maxSearchStates ?? 20000
    if (!Number.isSafeInteger(this.maxSearchStates) || this.maxSearchStates < 1)
      throw new Error("Invalid joint layer assignment work limit")
    if (!Number.isInteger(params.layerCount) || params.layerCount < 1)
      throw new Error("Invalid joint layer assignment layer count")
    this.stats = {
      activated: 1, inputRoutes: params.routes.length, eligibleRoutes: 0,
      candidateGroups: 0, searchStates: 0, completeAssignments: 0,
      copperRejected: 0, referenceRejected: 0, fullValidations: 0,
      accepted: 0, sitesBefore: 0, sitesAfter: 0,
      workLimitReached: 0, unsupportedRoutes: 0, sharedNetRoutes: 0,
      variantCacheHits: 0, variantCacheMisses: 0,
      pairCacheHits: 0, pairCacheMisses: 0,
      cachedVariantCount: 0, cachedPairCount: 0,
      staticGeometryEvaluations: 0, staticObstacleBroadphaseRejected: 0,
      staticPrimitiveBroadphaseRejected: 0, staticDistanceEvaluations: 0,
    }
    const baseline = params.evaluate(params.routes)
    this.stats.fullValidations++
    this.stats.baselineReferenceValid = baseline.valid
    this.stats.baselineStaticRejected = [...params.routes, ...params.fixedRoutes]
      .filter((route) => this.hasStaticConflict(route)).length
    this.stats.baselineValid = baseline.valid && this.stats.baselineStaticRejected === 0
    this.bestSites = baseline.manufacturedSites
    this.stats.sitesBefore = this.bestSites
    this.stats.sitesAfter = this.bestSites
    if (!this.stats.baselineValid) {
      // This optimizer has no authority to repair an invalid starting board.
      this.solved = true
      return
    }
    for (const [index, route] of params.routes.entries()) {
      const sections = this.getSections(route)
      if (!sections) {
        this.stats.unsupportedRoutes++
        continue
      }
      this.lockSameNetContacts(route, sections, index)
      const mutable = sections.filter((section) => !section.locked).length
      const layers = [...new Set(sections.map((section) => section.z))].sort((a, b) => a - b)
      if (mutable === 0 || mutable > 6 || layers.length < 2 || layers.length > 4) continue
      this.entries.push({ index, sections, layers })
    }
    this.stats.eligibleRoutes = this.entries.length
    const seen = new Set<string>()
    for (const seed of this.entries) {
      const neighbors = this.entries.filter((entry) => entry !== seed &&
        this.projectedBoundsOverlap(params.routes[seed.index], params.routes[entry.index]))
      // Each bounded connected neighborhood is exact against all outside copper.
      // Full graph components need not fit the bounded combinatorial budget.
      for (const neighbor of neighbors) {
        const group = [seed, neighbor].sort((a, b) => a.index - b.index)
        const key = group.map((entry) => entry.index).join(":")
        if (!seen.has(key)) { seen.add(key); this.groups.push(group) }
      }
      if (neighbors.length >= 2) {
        const group = [seed, ...neighbors.slice(0, 2)].sort((a, b) => a.index - b.index)
        const mutable = group.reduce((n, entry) => n + entry.sections.filter((s) => !s.locked).length, 0)
        const key = group.map((entry) => entry.index).join(":")
        if (mutable <= 10 && !seen.has(key)) { seen.add(key); this.groups.push(group) }
      }
    }
    const combinations = (group: Entry[]): number => group.reduce((product, entry) =>
      product * entry.layers.length ** entry.sections.filter((section) => !section.locked).length, 1)
    this.groups.sort((left, right) => combinations(left) - combinations(right) ||
      left.length - right.length || left[0].index - right[0].index)
    this.stats.candidateGroups = this.groups.length
    this.MAX_ITERATIONS = this.groups.length + 1
    if (this.groups.length === 0) this.solved = true
  }

  private lockSameNetContacts(route: HighDensityRoute, sections: Section[], index: number): void {
    const peers = [...this.params.routes.filter((_, i) => i !== index), ...this.params.fixedRoutes]
      .filter((other) => arePipeline9RoutesOnSameNet(route, other, this.params.connMap))
    if (peers.length === 0) return
    this.stats.sharedNetRoutes++
    const board = { layerCount: this.params.layerCount,
      allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias }
    for (const section of sections) {
      const wire = { ...route, route: section.points, vias: [] }
      if (peers.some((peer) => doPipeline9RoutesHaveCopperConflict({
        left: wire, right: peer, clearance: 0, ...board }))) section.locked = true
    }
    for (const via of getPipeline9RouteCopperGeometry(route, board).viaSpans) {
      const viaRoute = { ...route, route: [
        { ...via.center, z: via.minZ }, { ...via.center, z: via.maxZ }], vias: [via.center] }
      if (!peers.some((peer) => doPipeline9RoutesHaveCopperConflict({
        left: viaRoute, right: peer, clearance: 0, ...board }))) continue
      for (const section of sections) {
        if ([section.points[0], section.points.at(-1)!]
          .some((point) => point.x === via.center.x && point.y === via.center.y)) section.locked = true
      }
    }
  }

  private staticBoundsSeparated(left: StaticBounds, right: StaticBounds): boolean {
    return (
      left.maxX < right.minX ||
      left.maxY < right.minY ||
      left.minX > right.maxX ||
      left.minY > right.maxY
    )
  }

  private hasStaticConflict(route: HighDensityRoute): boolean {
    this.stats.staticGeometryEvaluations++
    const geometry = getPipeline9RouteCopperGeometry(route, this.params)
    const ids = [route.connectionName, route.rootConnectionName].filter((id): id is string => !!id)
    const ownerKey = JSON.stringify(ids)
    let obstacles = this.staticObstaclesByOwner.get(ownerKey)
    if (!obstacles) {
      obstacles = this.staticObstacles.filter(({ obstacle }) =>
        !ids.some((id) => obstacle.connectedTo.some((other) =>
          id === other || this.params.connMap.areIdsConnected(id, other))))
      this.staticObstaclesByOwner.set(ownerKey, obstacles)
      if (this.staticObstaclesByOwner.size > MAX_CACHED_STATIC_OWNERS)
        this.staticObstaclesByOwner.delete(this.staticObstaclesByOwner.keys().next().value!)
    }
    if (obstacles.length === 0) return false
    // These bounds use actual primitive widths, including per-point overrides.
    // Only provably separated boxes skip the unchanged narrow predicates.
    const wires = geometry.wireSegments.map((wire) => {
      const margin = wire.width / 2 + this.params.clearance
      const guard = 1e-9 + 16 * Number.EPSILON * Math.max(1, Math.abs(wire.start.x),
        Math.abs(wire.start.y), Math.abs(wire.end.x), Math.abs(wire.end.y), Math.abs(margin))
      return { wire, layer: mapZToLayerName(wire.z, this.params.layerCount), bounds: {
        minX: Math.min(wire.start.x, wire.end.x) - margin - guard,
        minY: Math.min(wire.start.y, wire.end.y) - margin - guard,
        maxX: Math.max(wire.start.x, wire.end.x) + margin + guard,
        maxY: Math.max(wire.start.y, wire.end.y) + margin + guard,
      } }
    })
    const vias = geometry.viaSpans.map((via) => {
      const margin = via.diameter / 2 + (this.params.viaToPadClearance ?? this.params.clearance)
      const guard = 1e-9 + 16 * Number.EPSILON * Math.max(1,
        Math.abs(via.center.x), Math.abs(via.center.y), Math.abs(margin))
      return { via, layers: Array.from({ length: via.maxZ - via.minZ + 1 }, (_, i) =>
        mapZToLayerName(via.minZ + i, this.params.layerCount)), bounds: {
        minX: via.center.x - margin - guard, minY: via.center.y - margin - guard,
        maxX: via.center.x + margin + guard, maxY: via.center.y + margin + guard,
      } }
    })
    const bounds = [...wires, ...vias].reduce<StaticBounds>((total, primitive) => ({
      minX: Math.min(total.minX, primitive.bounds.minX), minY: Math.min(total.minY, primitive.bounds.minY),
      maxX: Math.max(total.maxX, primitive.bounds.maxX), maxY: Math.max(total.maxY, primitive.bounds.maxY),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    for (const compiled of obstacles) {
      const { obstacle, cosine, sine } = compiled
      if (this.staticBoundsSeparated(bounds, compiled.bounds)) {
        this.stats.staticObstacleBroadphaseRejected++
        continue
      }
      const local = (point: { x: number; y: number }): { x: number; y: number } => {
        const x = point.x - obstacle.center.x, y = point.y - obstacle.center.y
        return { x: x * cosine - y * sine, y: x * sine + y * cosine }
      }
      const distance = (start: { x: number; y: number }, end: { x: number; y: number }): number => {
        return obstacle.shape === "circle"
          ? segmentToCircleMinDistance(start, end, { ...obstacle.center,
              radius: Math.max(obstacle.width, obstacle.height) / 2 })
          : segmentToBoundsMinDistance(local(start), local(end), {
              minX: -obstacle.width / 2, maxX: obstacle.width / 2,
              minY: -obstacle.height / 2, maxY: obstacle.height / 2 })
      }
      for (const { wire, layer, bounds } of wires) {
        if (!compiled.layers.has(layer)) continue
        if (this.staticBoundsSeparated(bounds, compiled.bounds)) {
          this.stats.staticPrimitiveBroadphaseRejected++
          continue
        }
        this.stats.staticDistanceEvaluations++
        if (distance(wire.start, wire.end) + 1e-9 < wire.width / 2 + this.params.clearance) return true
      }
      for (const { via, layers, bounds } of vias) {
        if (!layers.some((layer) => compiled.layers.has(layer))) continue
        if (this.staticBoundsSeparated(bounds, compiled.bounds)) {
          this.stats.staticPrimitiveBroadphaseRejected++
          continue
        }
        this.stats.staticDistanceEvaluations++
        if (distance(via.center, via.center) + 1e-9 <
          via.diameter / 2 + (this.params.viaToPadClearance ?? this.params.clearance)) return true
      }
    }
    return false
  }

  private getSections(route: HighDensityRoute): Section[] | undefined {
    if (route.jumpers?.length || route.route.length < 4 || route.vias.length < 2) return undefined
    const sections: Section[] = []
    const transitions = new Set<string>()
    for (const [index, point] of route.route.entries()) {
      if (![point.x, point.y, point.z].every(Number.isFinite) ||
        !Number.isInteger(point.z) || point.z < 0 || point.z >= this.params.layerCount)
        throw new Error("Invalid joint layer assignment route coordinate")
      if (point.toNextSegmentType || point.toNextSegmentCircuitJsonMetadata || point.insideJumperPad)
        return undefined
      const previous = route.route[index - 1]
      if (!previous || previous.z !== point.z) {
        if (previous) {
          if (previous.x !== point.x || previous.y !== point.y) return undefined
          transitions.add(JSON.stringify([point.x, point.y]))
        }
        sections.push({ points: [], z: point.z, locked: false })
      }
      const section = sections.at(-1)!
      section.points.push(point)
      if (point.pcb_port_id || index === 0 || index === route.route.length - 1)
        section.locked = true
    }
    const declared = new Set(route.vias.map((via) => JSON.stringify([via.x, via.y])))
    if (declared.size !== transitions.size || [...declared].some((key) => !transitions.has(key)))
      return undefined
    if (sections.some((section) => section.points.length < 2 ||
      !section.points.some((point) => point.x !== section.points[0].x || point.y !== section.points[0].y)))
      return undefined
    return sections
  }

  private projectedBoundsOverlap(left: HighDensityRoute, right: HighDensityRoute): boolean {
    const bounds = (route: HighDensityRoute): number[] => {
      const cached = this.routeBounds.get(route)
      if (cached) return cached
      const margin = Math.max(route.traceThickness, route.viaDiameter) / 2 + this.params.clearance
      const result = [Infinity, Infinity, -Infinity, -Infinity]
      for (const point of route.route) {
        result[0] = Math.min(result[0], point.x - margin)
        result[1] = Math.min(result[1], point.y - margin)
        result[2] = Math.max(result[2], point.x + margin)
        result[3] = Math.max(result[3], point.y + margin)
      }
      this.routeBounds.set(route, result)
      return result
    }
    const a = bounds(left), b = bounds(right)
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
  }

  private routeIdentity(route: HighDensityRoute): number {
    const cached = this.routeIdentities.get(route)
    if (cached !== undefined) return cached
    const identity = this.nextRouteIdentity++
    this.routeIdentities.set(route, identity)
    return identity
  }

  private hasConflict(left: HighDensityRoute, right: HighDensityRoute): boolean {
    // Route copper is immutable during this search. An accepted replacement is
    // a different object, so comparisons against older outside copper cannot
    // be reused. Keep the ordered predicate rather than assuming symmetry.
    const key = `${this.routeIdentity(left)}:${this.routeIdentity(right)}`
    const cached = this.pairConflictCache.get(key)
    if (cached !== undefined) {
      this.stats.pairCacheHits++
      return cached
    }
    this.stats.pairCacheMisses++
    const conflict = !arePipeline9RoutesOnSameNet(left, right, this.params.connMap) &&
      this.projectedBoundsOverlap(left, right) &&
      doPipeline9RoutesHaveCopperConflict({
        left, right, clearance: this.params.clearance,
        layerCount: this.params.layerCount,
        allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
      })
    this.pairConflictCache.set(key, conflict)
    if (this.pairConflictCache.size > MAX_CACHED_PAIRS)
      this.pairConflictCache.delete(this.pairConflictCache.keys().next().value!)
    this.stats.cachedPairCount = this.pairConflictCache.size
    return conflict
  }

  private makeVariants(entry: Entry, fixed: HighDensityRoute[], allowance: number): Variant[] {
    const original = this.bestRoutes[entry.index]
    const variants: Variant[] = []
    const layers: number[] = []
    const initialStates = this.stats.searchStates
    const visit = (index: number): void => {
      if (this.stats.searchStates >= this.maxSearchStates ||
        this.stats.searchStates - initialStates >= allowance) {
        this.stats.workLimitReached = 1
        return
      }
      this.stats.searchStates++
      if (index < entry.sections.length) {
        const section = entry.sections[index]
        for (const z of section.locked ? [section.z] : entry.layers) {
          layers[index] = z
          visit(index + 1)
        }
        return
      }
      const key = `${entry.index}:${this.routeIdentity(original)}:${layers.join(",")}`
      let variant = this.variantCache.get(key)
      if (variant) {
        this.stats.variantCacheHits++
      } else {
        this.stats.variantCacheMisses++
        const points: HighDensityRoute["route"] = []
        const vias = new Map<string, { x: number; y: number }>()
        for (const [i, section] of entry.sections.entries()) {
          for (const point of section.points) {
            const next = { ...point, z: layers[i] }
            const previous = points.at(-1)
            if (previous && previous.x === next.x && previous.y === next.y) {
              if (previous.z !== next.z) vias.set(JSON.stringify([next.x, next.y]), { x: next.x, y: next.y })
              else if (!next.pcb_port_id) continue
            }
            points.push(next)
          }
        }
        const candidate: HighDensityRoute = { ...original, route: points, vias: [...vias.values()] }
        variant = { route: candidate, sites: vias.size,
          staticConflict: this.hasStaticConflict(candidate) }
        this.variantCache.set(key, variant)
        if (this.variantCache.size > MAX_CACHED_VARIANTS)
          this.variantCache.delete(this.variantCache.keys().next().value!)
        this.stats.cachedVariantCount = this.variantCache.size
      }
      if (variant.staticConflict || fixed.some((other) => this.hasConflict(variant.route, other))) {
        this.stats.copperRejected++
        return
      }
      variants.push(variant)
    }
    visit(0)
    return variants.sort((a, b) => a.sites - b.sites)
  }

  override _step(): void {
    if (this.stats.searchStates >= this.maxSearchStates || this.stats.fullValidations >= 33) {
      this.stats.workLimitReached = 1
      this.solved = true
      return
    }
    const group = this.groups[this.groupIndex++]
    if (!group) { this.solved = true; return }
    const indexes = new Set(group.map((entry) => entry.index))
    const fixed = [...this.bestRoutes.filter((_, i) => !indexes.has(i)), ...this.params.fixedRoutes]
    // Reserve work for combining variants; enumeration must not consume the
    // entire budget before any coupled assignment can be evaluated.
    const variants = group.map((entry, i) => this.makeVariants(entry, fixed,
      Math.max(1, Math.floor((this.maxSearchStates - this.stats.searchStates) /
        (2 * (group.length - i))))))
    const chosen: HighDensityRoute[] = []
    const before = group.reduce((sum, entry) => sum + this.bestRoutes[entry.index].vias.length, 0)
    let bestGroupSites = before
    const visit = (depth: number, sites: number): void => {
      if (this.stats.searchStates >= this.maxSearchStates || this.stats.fullValidations >= 33) {
        this.stats.workLimitReached = 1
        return
      }
      this.stats.searchStates++
      if (sites >= bestGroupSites) return
      if (depth < group.length) {
        for (const variant of variants[depth]) {
          if (chosen.some((other) => this.hasConflict(variant.route, other))) {
            this.stats.copperRejected++
            continue
          }
          chosen.push(variant.route)
          visit(depth + 1, sites + variant.sites)
          chosen.pop()
        }
        return
      }
      this.stats.completeAssignments++
      const candidate = this.bestRoutes.slice()
      for (const [i, entry] of group.entries()) candidate[entry.index] = chosen[i]
      const evaluated = this.params.evaluate(candidate)
      this.stats.fullValidations++
      if (!evaluated.valid) { this.stats.referenceRejected++; return }
      if (evaluated.manufacturedSites >= this.bestSites) return
      this.bestRoutes = candidate
      this.bestSites = evaluated.manufacturedSites
      this.stats.sitesAfter = this.bestSites
      this.stats.accepted++
      bestGroupSites = sites
    }
    visit(0, 0)
    if (this.groupIndex >= this.groups.length) this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Joint layer assignment output requested before completion")
    return this.bestRoutes
  }
}
