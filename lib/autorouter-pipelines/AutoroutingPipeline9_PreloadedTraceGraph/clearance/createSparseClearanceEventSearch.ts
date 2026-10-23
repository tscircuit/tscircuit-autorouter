import Flatbush from "flatbush"
import { ClearancePathHeap } from "./ClearancePathHeap"
import { REGION_EPSILON } from "./repairRegionGeometry"
import { getClearanceCapsuleSupportOrientation, type ClearanceCorridorStats, type ClearanceCostSupport, type CorridorSearchInput } from "./createClearanceCorridorSearch"
import type { RepairRoutePoint } from "./repairRegionTypes"

type Point = RepairRoutePoint
type Site = { x: number; y: number; gx?: number; gy?: number }
type Vertex = { id: number; site: number; point: Point }
type State = { id: number; vertex: Vertex; sites: number[]; key: string; cost: number; parent?: State }
type Support = ClearanceCostSupport & { portals: number[]; angles: number[]; soft: boolean }
type Interval = { enter: number; exit: number }
export type SparseClearanceEventStats = ClearanceCorridorStats & {
  corridorSparsePolicy: number
  corridorSparseSetupCandidates: number
  corridorSparseSites: number
  corridorSparseVertices: number
  corridorSparseVertexBound: number
  corridorSparseNeighborLists: number
  corridorSparseNeighborReferences: number
  corridorSparseNeighborCacheHits: number
  corridorSparseRejectedLabels: number
  corridorSparseCostPieces: number
  corridorSparseCostCallbacks: number
  corridorSparseCostSupportChecks: number
  corridorSparseSolutionCost: number
  corridorSparseBoundaryReferences: number
  corridorSparseBoundaryIntervals: number
  corridorSparseSiteLookups: number
  corridorSparseSetupKeyCharacters: number
  corridorSparseVertexLookups: number
  corridorSparseHistoryCopies: number
  corridorSparseHistoryCopyElements: number
  corridorSparseHistoryKeyCharacters: number
  corridorRetainedSparseSites: number
  corridorRetainedSparseVertices: number
  corridorRetainedSparseNeighborReferences: number
  corridorRetainedSparseBoundaryReferences: number
  corridorRetainedSparseHistoryArrays: number
  corridorRetainedSparseHistoryElements: number
}

/** Exact interval in the intersection of the supplied enclosing boxes. */
function supportInterval(support: ClearanceCostSupport, a: Point, b: Point): Interval | undefined {
  let enter = 0, exit = 1
  const slabs: Array<[number, number, number, number]> = [[a.x, b.x - a.x, support.minX, support.maxX], [a.y, b.y - a.y, support.minY, support.maxY]]
  if (support.orientation) {
    const r = support.orientation, x = a.x - r.x, y = a.y - r.y, dx = b.x - a.x, dy = b.y - a.y
    slabs.push([x * r.cos + y * r.sin, dx * r.cos + dy * r.sin, -r.halfWidth, r.halfWidth],
      [-x * r.sin + y * r.cos, -dx * r.sin + dy * r.cos, -r.halfHeight, r.halfHeight])
  }
  for (const [origin, delta, min, max] of slabs) {
    if (delta === 0) { if (origin < min || origin > max) return undefined }
    else {
      const first = (min - origin) / delta, last = (max - origin) / delta
      enter = Math.max(enter, Math.min(first, last))
      exit = Math.min(exit, Math.max(first, last))
    }
  }
  return enter <= exit ? { enter, exit } : undefined
}

/**
 * A finite event policy, not a contraction/completeness claim for the grid.
 * Vertices belong to physical supports, terminal neighborhoods or supplied
 * path hints. First-support visibility discovers their edges lazily. There
 * are no ordinary interior grid successors or arbitrary interior via sites.
 */
export function createSparseClearanceEventSearch(input: CorridorSearchInput & { waypoints?: readonly Point[] }): {
  step: () => void; nodeCount: number; maximumWork: number; stats: SparseClearanceEventStats
} {
  const { bounds, start, end, grid, layerCount } = input
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, start.x, start.y, end.x, end.y].every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) throw new Error("Sparse clearance events require finite positive bounds")
  if (!Number.isSafeInteger(layerCount) || layerCount < 1 || ![start.z, end.z].every((z) => Number.isInteger(z) && z >= 0 && z < layerCount)) throw new Error("Sparse clearance events require valid anchor layers")
  if (![grid, input.wireReach, input.viaReach, input.traceThickness, input.drillSpacing].every((n) => Number.isFinite(n) && n > 0) || !Number.isSafeInteger(input.maxNodes) || input.maxNodes < 1 || !Number.isFinite(input.heuristicWeight) || input.heuristicWeight < 1 || !Number.isSafeInteger(input.maximumPredicateWork ?? 0) || (input.maximumPredicateWork ?? 0) < 0) throw new Error("Sparse clearance events require finite physical rules and effort")
  const nx = Math.floor((bounds.maxX - bounds.minX) / grid), ny = Math.floor((bounds.maxY - bounds.minY) / grid)
  if (nx < 1 || ny < 1 || !Number.isSafeInteger(nx * ny * layerCount) || grid <= Number.EPSILON * Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY))) throw new Error("Sparse clearance connector grid is outside its finite precision domain")
  const hintCount = input.waypoints?.length ?? 0
  const supportBound = input.barriers.length + input.additionalCostSupports.length
  const siteBound = 2 + 50 + 8 + 16 * supportBound + hintCount
  const degreeBound = 25 + 25 + 8 + 11 * 2 + 2 * supportBound + 2 * hintCount + layerCount + 1
  const piecesBound = Math.ceil(Math.max(bounds.maxX, start.x, end.x) - Math.min(bounds.minX, start.x, end.x)) / grid + Math.ceil(Math.max(bounds.maxY, start.y, end.y) - Math.min(bounds.minY, start.y, end.y)) / grid + 2
  if (!Number.isSafeInteger(siteBound * layerCount) || !Number.isFinite(piecesBound)) throw new Error("Sparse clearance event capacity exceeds finite accounting")
  // A separate explicit maintenance bound includes setup, first-support scans,
  // primitive cost integration, exact histories and physical callback work.
  const maximum = 4096n + BigInt(siteBound + supportBound) * 128n + BigInt(input.maxNodes + 1) *
    (BigInt(supportBound + 1) * 128n + BigInt(degreeBound) *
      (BigInt(Math.ceil(piecesBound)) * BigInt((input.maximumPredicateWork ?? 0) + 32) + BigInt(input.additionalCostSupports.length + 1) ** 2n + BigInt(supportBound + 1) * 16n + BigInt(input.maxNodes) * 192n + 256n))
  const maximumWork = Number(maximum > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : maximum)
  const stats: SparseClearanceEventStats = {
    corridorWorkUnits: 0, corridorMaximumMaintenanceWork: maximumWork, corridorMaintenanceLimitReached: 0,
    corridorIndexEntries: 0, corridorEventQueries: 0, corridorEventCandidates: 0, corridorLocalEdgeChecks: 0,
    corridorGeneratedNeighbors: 0, corridorRunEdges: 0, corridorRunGridSteps: 0, corridorExpandedRunSteps: 0,
    corridorHistoryChecks: 0, corridorRetainedStates: 0, corridorNodesPopped: 0, corridorPortalEdges: 0,
    corridorPredicateWork: 0, corridorPortalRelaxations: 0, corridorPortalExpansions: 0, corridorPortalPathEdges: 0,
    corridorDominanceWitnessChecks: 0, corridorDominanceSubsetChecks: 0, corridorDominanceIndexWork: 0,
    corridorDominanceSuppressed: 0, corridorOrientedSupports: 0, corridorOrientedIntervalChecks: 0,
    corridorIntervalBuilds: 0, corridorIntervalCacheHits: 0, corridorIntervalSearchChecks: 0,
    corridorIntervalSortChecks: 0, corridorRetainedIntervalLines: 0, corridorRetainedIntervals: 0,
    corridorGoalEventCacheHits: 0, corridorRetainedGoalEvents: 0, corridorHistoryMaskBuilds: 0,
    corridorHistoryMaskChecks: 0, corridorDominanceMaskRejections: 0, corridorExactEdgeCacheHits: 0,
    corridorExactEdgeCacheMisses: 0, corridorRetainedExactEdges: 0,
    corridorSparsePolicy: 1, corridorSparseSetupCandidates: 0, corridorSparseSites: 0,
    corridorSparseVertices: 0, corridorSparseVertexBound: siteBound * layerCount,
    corridorSparseNeighborLists: 0, corridorSparseNeighborReferences: 0, corridorSparseNeighborCacheHits: 0,
    corridorSparseRejectedLabels: 0, corridorSparseCostPieces: 0, corridorSparseCostCallbacks: 0,
    corridorSparseCostSupportChecks: 0, corridorSparseSolutionCost: 0,
    corridorSparseBoundaryReferences: 0, corridorSparseBoundaryIntervals: 0, corridorSparseSiteLookups: 0,
    corridorSparseSetupKeyCharacters: 0, corridorSparseVertexLookups: 0, corridorSparseHistoryCopies: 0,
    corridorSparseHistoryCopyElements: 0, corridorSparseHistoryKeyCharacters: 0,
    corridorRetainedSparseSites: 0, corridorRetainedSparseVertices: 0, corridorRetainedSparseNeighborReferences: 0,
    corridorRetainedSparseBoundaryReferences: 0, corridorRetainedSparseHistoryArrays: 0, corridorRetainedSparseHistoryElements: 0,
  }
  const sites: Site[] = [], supports: Support[] = [], vertices: Vertex[] = [], states: State[] = []
  const siteByXY = new Map<string, number>(), vertexBySite = new Map<string, Vertex>(), stateByKey = new Map<string, State>()
  const neighborCache = new Map<number, Vertex[]>(), edgeCosts = new Map<number, Map<number, number>>()
  const witnesses = new Map<number, State[]>(), singles = new Map<number, Map<number, State>>(), empty = new Map<number, State>()
  const hintNeighbors = new Map<number, Set<number>>()
  const boundaryNeighbors = new Map<number, Set<number>>()
  const retainedHistories = new WeakSet<number[]>()
  const heap = new ClearancePathHeap()
  let index: Flatbush | undefined, popped = 0, edgeChecks = 0, finished = false, popCheckpoint = false
  const addSite = (x: number, y: number, force = false, gx?: number, gy?: number): number | undefined => {
    stats.corridorSparseSetupCandidates++
    stats.corridorWorkUnits++
    if (![x, y].every(Number.isFinite)) throw new Error("Sparse clearance portal is nonfinite")
    if (!force && (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY)) return undefined
    const key = JSON.stringify([x, y]), previous = siteByXY.get(key)
    stats.corridorSparseSiteLookups++
    stats.corridorSparseSetupKeyCharacters += key.length
    stats.corridorWorkUnits += key.length
    if (previous !== undefined) {
      if (gx !== undefined) Object.assign(sites[previous]!, { gx, gy })
      return previous
    }
    const id = sites.length
    sites.push({ x, y, gx, gy })
    siteByXY.set(key, id)
    stats.corridorSparseSites = sites.length
    stats.corridorRetainedSparseSites = sites.length
    return id
  }
  const vertexAt = (site: number, z: number): Vertex => {
    stats.corridorSparseVertexLookups++
    stats.corridorWorkUnits++
    const key = `${site}:${z}`, previous = vertexBySite.get(key)
    if (previous) return previous
    const xy = sites[site]!
    const vertex: Vertex = { id: vertices.length, site, point: { x: xy.x, y: xy.y, z, traceThickness: input.traceThickness } }
    vertices.push(vertex)
    vertexBySite.set(key, vertex)
    stats.corridorSparseVertices = vertices.length
    stats.corridorRetainedSparseVertices = vertices.length
    return vertex
  }
  const neighborhood = (anchor: Point): number[] => {
    const result: number[] = [], sx = Math.max(0, Math.min(nx - 1, Math.floor((anchor.x - bounds.minX) / grid))), sy = Math.max(0, Math.min(ny - 1, Math.floor((anchor.y - bounds.minY) / grid)))
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const x = sx + dx, y = sy + dy
      if (x < 0 || x >= nx || y < 0 || y >= ny) continue
      result.push(addSite(bounds.minX + (x + 0.5) * grid, bounds.minY + (y + 0.5) * grid, false, x, y)!)
    }
    return result
  }
  const callPredicate = (operation: () => number | boolean): number | boolean => {
    const before = input.getPredicateWork?.() ?? 0, result = operation(), work = (input.getPredicateWork?.() ?? 0) - before
    if (!Number.isSafeInteger(work) || work < 0) throw new Error("Sparse physical predicate work is not an exact nonnegative count")
    stats.corridorPredicateWork += work
    stats.corridorWorkUnits += work
    return result
  }
  const dominates = function* (vertex: Vertex, history: number[], cost: number, self?: State): Generator<void, boolean> {
    stats.corridorDominanceIndexWork++
    yield
    const zero = empty.get(vertex.id)
    if (zero && zero !== self && zero.cost <= cost) return true
    for (const site of history) {
      stats.corridorDominanceIndexWork++
      yield
      const single = singles.get(vertex.id)?.get(site)
      if (single && single !== self && single.cost <= cost) return true
    }
    for (const witness of witnesses.get(vertex.id) ?? []) {
      stats.corridorDominanceWitnessChecks++
      yield
      if (witness === self || witness.cost > cost || witness.sites.length > history.length) continue
      let cursor = 0, subset = true
      for (const site of witness.sites) {
        while (cursor < history.length && history[cursor]! < site) { cursor++; stats.corridorDominanceSubsetChecks++; yield }
        stats.corridorDominanceSubsetChecks++
        yield
        if (history[cursor] !== site) { subset = false; break }
      }
      if (subset) return true
    }
    return false
  }
  const exactCost = function* (a: Vertex, b: Vertex): Generator<void, number> {
    let column = edgeCosts.get(a.id)
    const cached = column?.get(b.id)
    if (cached !== undefined) { stats.corridorExactEdgeCacheHits++; yield; return cached }
    stats.corridorExactEdgeCacheMisses++
    stats.corridorLocalEdgeChecks++
    edgeChecks++
    yield
    let cost = Infinity
    if (callPredicate(() => input.clear(a.point, b.point))) {
      const via = a.point.z !== b.point.z
      cost = via ? 1 : Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y)
      if (via) {
        const extra = callPredicate(() => input.extraCost(a.point, b.point)) as number
        stats.corridorSparseCostCallbacks++
        if (Number.isNaN(extra) || extra < 0) throw new Error("Sparse event cost must be nonnegative")
        cost += extra
        yield
      } else if (input.additionalCostSupports.length > 0) {
        if (!index) throw new Error("Sparse cost supports have no physical index")
        const intervals: Interval[] = []
        stats.corridorEventQueries++
        yield
        for (const id of index.search(Math.min(a.point.x, b.point.x), Math.min(a.point.y, b.point.y), Math.max(a.point.x, b.point.x), Math.max(a.point.y, b.point.y))) {
          stats.corridorSparseCostSupportChecks++
          yield
          const support = supports[id]!
          if (!support.soft || a.point.z < support.minZ || a.point.z > support.maxZ) continue
          const interval = supportInterval(support, a.point, b.point)
          if (interval) intervals.push(interval)
        }
        intervals.sort((left, right) => { stats.corridorIntervalSortChecks++; stats.corridorWorkUnits++; return left.enter - right.enter || left.exit - right.exit })
        const merged: Interval[] = []
        for (const interval of intervals) {
          const previous = merged.at(-1)
          if (previous && interval.enter <= previous.exit) previous.exit = Math.max(previous.exit, interval.exit)
          else merged.push({ ...interval })
          yield
        }
        const first = sites[a.site]!, last = sites[b.site]!
        const dx = first.gx !== undefined && last.gx !== undefined ? last.gx - first.gx : undefined
        const dy = first.gy !== undefined && last.gy !== undefined ? last.gy - first.gy : undefined
        const nativeRun = dx !== undefined && dy !== undefined && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))
        const pieces = Math.max(1, nativeRun ? Math.max(Math.abs(dx!), Math.abs(dy!)) : Math.ceil(Math.max(Math.abs(b.point.x - a.point.x), Math.abs(b.point.y - a.point.y)) / grid))
        const at = (i: number): Point => i === 0 ? a.point : i === pieces ? b.point : ({
          x: nativeRun ? bounds.minX + (first.gx! + dx! * i / pieces + 0.5) * grid : a.point.x + (b.point.x - a.point.x) * i / pieces,
          y: nativeRun ? bounds.minY + (first.gy! + dy! * i / pieces + 0.5) * grid : a.point.y + (b.point.y - a.point.y) * i / pieces,
          z: a.point.z, traceThickness: input.traceThickness,
        })
        let previousPiece = -1
        for (const interval of merged) for (let i = Math.max(previousPiece + 1, Math.max(0, Math.ceil(interval.enter * pieces) - 1)); i < Math.min(pieces, Math.floor(interval.exit * pieces) + 1); i++) {
          const extra = callPredicate(() => input.extraCost(at(i), at(i + 1))) as number
          stats.corridorSparseCostPieces++
          stats.corridorSparseCostCallbacks++
          yield
          if (Number.isNaN(extra) || extra < 0) throw new Error("Sparse integrated edge cost must be nonnegative")
          cost += extra
          previousPiece = i
          if (!Number.isFinite(cost)) break
        }
      }
    }
    if (!column) { column = new Map(); edgeCosts.set(a.id, column) }
    column.set(b.id, cost)
    stats.corridorRetainedExactEdges++
    return cost
  }
  const relax = function* (from: State, vertex: Vertex, history: number[], key: string): Generator<void> {
    stats.corridorGeneratedNeighbors++
    yield
    const labelKey = `${vertex.id}|${key}`, existing = stateByKey.get(labelKey)
    const base = vertex.point.z !== from.vertex.point.z ? 1 : Math.hypot(vertex.point.x - from.vertex.point.x, vertex.point.y - from.vertex.point.y)
    if (from.cost + base >= (existing?.cost ?? Infinity) || (yield* dominates(vertex, history, from.cost + base, existing))) { stats.corridorSparseRejectedLabels++; return }
    const cost = from.cost + (yield* exactCost(from.vertex, vertex))
    if (!Number.isFinite(cost) || cost >= (existing?.cost ?? Infinity) || (yield* dominates(vertex, history, cost, existing))) { stats.corridorSparseRejectedLabels++; return }
    // A blocked or dominated descriptor never becomes an Infinity label.
    const state: State = existing ?? { id: states.length, vertex, sites: history, key, cost: Infinity }
    if (!existing) {
      states.push(state); stateByKey.set(labelKey, state); stats.corridorRetainedStates = states.length
      if (!retainedHistories.has(history)) {
        retainedHistories.add(history)
        stats.corridorRetainedSparseHistoryArrays++
        stats.corridorRetainedSparseHistoryElements += history.length
      }
    }
    state.cost = cost
    state.parent = from
    const estimate = Math.hypot(vertex.point.x - end.x, vertex.point.y - end.y) + Number(vertex.point.z !== end.z)
    heap.push({ id: state.id, cost, priority: cost + input.heuristicWeight * estimate })
  }
  const firstSupports = function* (a: Point, b: Point, count: number): Generator<void, Array<{ id: number; enter: number; exit: number }>> {
    if (supports.length === 0) return []
    if (!index) throw new Error("Sparse event supports have no physical index")
    stats.corridorEventQueries++
    yield
    const nearest: Array<{ id: number; enter: number; exit: number }> = []
    for (const id of index.search(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
      stats.corridorEventCandidates++
      yield
      const support = supports[id]!
      if (a.z < support.minZ || a.z > support.maxZ) continue
      const interval = supportInterval(support, a, b)
      if (!interval) continue
      nearest.push({ id, enter: interval.enter, exit: interval.exit })
      nearest.sort((left, right) => { stats.corridorIntervalSortChecks++; stats.corridorWorkUnits++; return left.enter - right.enter || left.id - right.id })
      if (nearest.length > count) nearest.pop()
    }
    return nearest
  }
  let goal: Vertex, sourceNeighborhood: number[], goalNeighborhood: number[], boundarySites: number[]
  const neighbors = function* (vertex: Vertex): Generator<void, Vertex[]> {
    const cached = neighborCache.get(vertex.id)
    if (cached) { stats.corridorSparseNeighborCacheHits++; yield; return cached }
    const ids = new Set<number>([...goalNeighborhood, ...boundarySites, ...(hintNeighbors.get(vertex.site) ?? []), ...(boundaryNeighbors.get(vertex.site) ?? [])])
    const expose = function* (target: Point, count: number): Generator<void> {
      for (const event of yield* firstSupports(vertex.point, target, count)) {
        const support = supports[event.id]!
        if (support.portals.length === 0) continue
        const r = support.orientation ?? { x: (support.minX + support.maxX) / 2, y: (support.minY + support.maxY) / 2, cos: 1, sin: 0 }
        const t = event.enter > 0 ? event.enter : event.exit
        const x = vertex.point.x + (target.x - vertex.point.x) * t - r.x, y = vertex.point.y + (target.y - vertex.point.y) * t - r.y
        const angle = Math.atan2(-x * r.sin + y * r.cos, x * r.cos + y * r.sin)
        let lo = 0, hi = support.angles.length
        while (lo < hi) { const middle = Math.floor((lo + hi) / 2); stats.corridorIntervalSearchChecks++; yield; if (support.angles[middle]! < angle) lo = middle + 1; else hi = middle }
        ids.add(support.portals[lo % support.portals.length]!)
        ids.add(support.portals[(lo + support.portals.length - 1) % support.portals.length]!)
        stats.corridorSparseBoundaryIntervals++
      }
    }
    yield* expose({ ...end, z: vertex.point.z }, 3)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue
      const reach = Math.min(dx > 0 ? (bounds.maxX - vertex.point.x) / dx : dx < 0 ? (bounds.minX - vertex.point.x) / dx : Infinity,
        dy > 0 ? (bounds.maxY - vertex.point.y) / dy : dy < 0 ? (bounds.minY - vertex.point.y) / dy : Infinity)
      if (!Number.isFinite(reach) || reach < 0) continue
      yield* expose({ x: vertex.point.x + dx * reach, y: vertex.point.y + dy * reach, z: vertex.point.z }, 1)
    }
    const result = [...ids].filter((site) => site !== vertex.site).map((site) => vertexAt(site, vertex.point.z))
    if (vertex.point.z === end.z && vertex !== goal) result.push(goal)
    neighborCache.set(vertex.id, result)
    stats.corridorSparseNeighborLists = neighborCache.size
    stats.corridorSparseNeighborReferences += result.length
    stats.corridorRetainedSparseNeighborReferences = stats.corridorSparseNeighborReferences
    return result
  }
  const expand = function* (state: State, seed = false): Generator<void> {
    const cached = yield* neighbors(state.vertex)
    const destinations = seed ? [...cached] : cached
    if (seed) for (const site of sourceNeighborhood) if (site !== state.vertex.site) destinations.push(vertexAt(site, start.z))
    for (const vertex of destinations) { stats.corridorPortalEdges++; yield* relax(state, vertex, state.sites, state.key) }
    if (!input.allowLayerChanges) return
    let legal = true, already = false, insertion = 0
    for (const previous of state.sites) {
      stats.corridorHistoryChecks++
      yield
      if (previous === state.vertex.site) already = true
      else if (Math.hypot(sites[previous]!.x - state.vertex.point.x, sites[previous]!.y - state.vertex.point.y) + REGION_EPSILON < input.drillSpacing) legal = false
      if (previous < state.vertex.site) insertion++
    }
    if (!legal) return
    const history = already ? state.sites : [...state.sites]
    if (!already) {
      history.splice(insertion, 0, state.vertex.site)
      stats.corridorSparseHistoryCopies++
      stats.corridorSparseHistoryCopyElements += state.sites.length
      stats.corridorWorkUnits += state.sites.length
    }
    const key = history.join(",")
    stats.corridorSparseHistoryKeyCharacters += key.length
    stats.corridorWorkUnits += key.length
    for (let z = 0; z < layerCount; z++) if (z !== state.vertex.point.z) yield* relax(state, vertexAt(state.vertex.site, z), history, key)
  }
  const computation = function* (): Generator<void, Point[] | null> {
    const startSite = addSite(start.x, start.y, true)!, endSite = addSite(end.x, end.y, true)!
    const source = vertexAt(startSite, start.z)
    source.point = { ...start }
    goal = vertexAt(endSite, end.z)
    if (goal === source) { goal = { id: vertices.length, site: endSite, point: { ...end } }; vertices.push(goal) }
    else goal.point = { ...end }
    stats.corridorSparseVertices = vertices.length
    stats.corridorRetainedSparseVertices = vertices.length
    sourceNeighborhood = neighborhood(start)
    goalNeighborhood = neighborhood(end)
    const insetX = Math.min(grid / 2, (bounds.maxX - bounds.minX) / 2), insetY = Math.min(grid / 2, (bounds.maxY - bounds.minY) / 2)
    boundarySites = []
    for (const x of [bounds.minX + insetX, (bounds.minX + bounds.maxX) / 2, bounds.maxX - insetX]) for (const y of [bounds.minY + insetY, (bounds.minY + bounds.maxY) / 2, bounds.maxY - insetY]) {
      if (x === (bounds.minX + bounds.maxX) / 2 && y === (bounds.minY + bounds.maxY) / 2) continue
      boundarySites.push(addSite(x, y)!)
    }
    let previousHint: number | undefined
    for (const point of input.waypoints ?? []) {
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error("Sparse clearance path hint is nonfinite")
      const site = addSite(point.x, point.y)
      if (site !== undefined && previousHint !== undefined && site !== previousHint) {
        for (const [a, b] of [[site, previousHint], [previousHint, site]]) {
          const adjacent = hintNeighbors.get(a!) ?? new Set<number>(); adjacent.add(b!); hintNeighbors.set(a!, adjacent)
        }
      }
      previousHint = site
      yield
    }
    for (const barrier of input.barriers) {
      const reach = barrier.viaOnly ? input.viaReach : input.wireReach
      let orientation = barrier.rect && barrier.a ? { x: barrier.a.x, y: barrier.a.y, cos: Math.cos(barrier.rect.rotation), sin: Math.sin(barrier.rect.rotation), halfWidth: barrier.rect.width / 2 + reach, halfHeight: barrier.rect.height / 2 + reach } : barrier.a && barrier.b && barrier.radius !== undefined ? getClearanceCapsuleSupportOrientation(barrier.a, barrier.b, barrier.radius + reach) : undefined
      supports.push({ minX: barrier.minX - reach, maxX: barrier.maxX + reach, minY: barrier.minY - reach, maxY: barrier.maxY + reach,
        minZ: barrier.minZ ?? 0, maxZ: barrier.maxZ ?? layerCount - 1, orientation, portals: [], angles: [], soft: false })
      yield
    }
    for (const support of input.additionalCostSupports) { supports.push({ ...support, portals: [], angles: [], soft: true }); yield }
    for (const support of supports) {
      if (![support.minX, support.maxX, support.minY, support.maxY, support.minZ, support.maxZ].every(Number.isFinite) || support.minX > support.maxX || support.minY > support.maxY || !Number.isInteger(support.minZ) || !Number.isInteger(support.maxZ) || support.minZ < 0 || support.maxZ >= layerCount || support.minZ > support.maxZ) throw new Error("Sparse clearance support has invalid geometry/layers")
      const r = support.orientation ?? { x: (support.minX + support.maxX) / 2, y: (support.minY + support.maxY) / 2, cos: 1, sin: 0, halfWidth: (support.maxX - support.minX) / 2, halfHeight: (support.maxY - support.minY) / 2 }
      if (!Object.values(r).every(Number.isFinite) || r.halfWidth < 0 || r.halfHeight < 0 || Math.abs(Math.hypot(r.cos, r.sin) - 1) > 1e-12) throw new Error("Sparse clearance support frame is invalid")
      if (support.orientation) stats.corridorOrientedSupports++
      const padding = 64 * Number.EPSILON * Math.max(1, Math.abs(r.x), Math.abs(r.y), r.halfWidth, r.halfHeight)
      const w = r.halfWidth + padding, h = r.halfHeight + padding
      const local: Site[] = []
      for (const x of [-w, 0, w]) for (const y of [-h, 0, h]) if (x !== 0 || y !== 0) local.push({ x, y })
      for (const anchor of [start, end]) {
        const x = (anchor.x - r.x) * r.cos + (anchor.y - r.y) * r.sin, y = -(anchor.x - r.x) * r.sin + (anchor.y - r.y) * r.cos
        for (const sx of [-w, w]) local.push({ x: sx, y: Math.max(-h, Math.min(h, y)) })
        for (const sy of [-h, h]) local.push({ x: Math.max(-w, Math.min(w, x)), y: sy })
      }
      const portals = new Map<number, number>()
      for (const p of local) {
        const site = addSite(r.x + p.x * r.cos - p.y * r.sin, r.y + p.x * r.sin + p.y * r.cos)
        if (site !== undefined) portals.set(site, Math.atan2(p.y, p.x))
      }
      const ordered = [...portals].sort(([a, aa], [b, ba]) => { stats.corridorIntervalSortChecks++; stats.corridorWorkUnits++; return aa - ba || a - b })
      support.portals = ordered.map(([id]) => id)
      support.angles = ordered.map(([, angle]) => angle)
      for (let i = 0; i < support.portals.length; i++) {
        const a = support.portals[i]!, b = support.portals[(i + 1) % support.portals.length]!
        if (a === b) continue
        for (const [from, to] of [[a, b], [b, a]]) {
          const adjacent = boundaryNeighbors.get(from!) ?? new Set<number>()
          if (!adjacent.has(to!)) { adjacent.add(to!); stats.corridorSparseBoundaryReferences++ }
          boundaryNeighbors.set(from!, adjacent)
          stats.corridorWorkUnits++
        }
      }
      stats.corridorRetainedSparseBoundaryReferences = stats.corridorSparseBoundaryReferences
      yield
    }
    if (sites.length > siteBound) throw new Error("Sparse event site capacity was undercounted")
    if (supports.length > 0) {
      index = new Flatbush(supports.length)
      for (const support of supports) { index.add(support.minX, support.minY, support.maxX, support.maxY); stats.corridorIndexEntries++; yield }
      index.finish()
    }
    const sourceState: State = { id: states.length, vertex: source, sites: [], key: "", cost: 0 }
    states.push(sourceState)
    retainedHistories.add(sourceState.sites)
    stats.corridorRetainedSparseHistoryArrays++
    stateByKey.set(`${source.id}|`, sourceState)
    yield* expand(sourceState, true)
    empty.set(source.id, sourceState)
    while (heap.length > 0) {
      popCheckpoint = true
      yield
      popCheckpoint = false
      const current = heap.pop(), state = states[current.id]!
      popped++
      stats.corridorNodesPopped = popped
      yield
      if (current.cost !== state.cost || (yield* dominates(state.vertex, state.sites, state.cost, state))) continue
      stats.corridorPortalExpansions++
      if (state.vertex === goal) {
        const path: Point[] = []
        for (let cursor: State | undefined = state; cursor; cursor = cursor.parent) { path.push({ ...cursor.vertex.point }); yield }
        path.reverse()
        stats.corridorSparseSolutionCost = state.cost
        stats.corridorPortalPathEdges = path.length - 1
        return path
      }
      yield* expand(state)
      if (state.sites.length === 0) empty.set(state.vertex.id, state)
      else if (state.sites.length === 1) {
        const previous = singles.get(state.vertex.id) ?? new Map<number, State>(); previous.set(state.sites[0]!, state); singles.set(state.vertex.id, previous)
      } else {
        const previous = witnesses.get(state.vertex.id) ?? []
        if (!previous.includes(state)) previous.push(state)
        if (previous.length > 32) {
          let worst = 0
          for (let i = 1; i < previous.length; i++) { stats.corridorDominanceIndexWork++; yield; if (previous[i]!.sites.length > previous[worst]!.sites.length || previous[i]!.sites.length === previous[worst]!.sites.length && previous[i]!.cost > previous[worst]!.cost) worst = i }
          previous.splice(worst, 1)
        }
        witnesses.set(state.vertex.id, previous)
      }
    }
    return null
  }()
  const step = (): void => {
    if (finished) throw new Error("Sparse clearance event search stepped after completion")
    for (let operation = 0; operation < 128; operation++) {
      if (popCheckpoint && popped >= input.maxNodes || stats.corridorWorkUnits >= maximumWork) {
        stats.corridorMaintenanceLimitReached = Number(stats.corridorWorkUnits >= maximumWork)
        stats.corridorRetainedStates = states.length
        finished = true
        input.finish(null, popped, "node-limit", edgeChecks, stats)
        return
      }
      const next = computation.next()
      if (next.done) {
        finished = true
        stats.corridorRetainedStates = states.length
        input.finish(next.value, popped, next.value ? "found" : "no-path", edgeChecks, stats)
        return
      }
      stats.corridorWorkUnits++
    }
  }
  return { step, nodeCount: siteBound * layerCount, maximumWork, stats }
}
