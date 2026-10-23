import Flatbush from "flatbush"
import type { Bounds, RepairRoutePoint } from "./repairRegionTypes"
import { ClearancePathHeap } from "./ClearancePathHeap"
import { REGION_EPSILON } from "./repairRegionGeometry"

type Point = RepairRoutePoint
type CorridorBarrier = Bounds & {
  viaOnly?: boolean; minZ?: number; maxZ?: number
  a?: Point; b?: Point; radius?: number
  rect?: { width: number; height: number; rotation: number }
}
type Interval = { enter: number; exit: number }
type GoalEvent = { blocker?: ClearanceCostSupport; hardSupportCrossed: boolean }
type HistoryMasks = { a: number; b: number }
export type ClearanceSupportOrientation = {
  x: number; y: number; cos: number; sin: number; halfWidth: number; halfHeight: number
}
export type ClearanceCostSupport = Bounds & { minZ: number; maxZ: number; orientation?: ClearanceSupportOrientation }
type State = {
  id: number
  gridId: number
  point: Point
  sites: number[]
  siteKey: string
  cost: number
  incomingRunSteps: number
  incomingPortal: boolean
  parent?: State
  masks?: HistoryMasks
}
export type ClearanceCorridorStats = {
  corridorWorkUnits: number
  corridorMaximumMaintenanceWork: number
  corridorMaintenanceLimitReached: number
  corridorIndexEntries: number
  corridorEventQueries: number
  corridorEventCandidates: number
  corridorLocalEdgeChecks: number
  corridorGeneratedNeighbors: number
  corridorRunEdges: number
  corridorRunGridSteps: number
  corridorExpandedRunSteps: number
  corridorHistoryChecks: number
  corridorRetainedStates: number
  corridorNodesPopped: number
  corridorPortalEdges: number
  corridorPredicateWork: number
  corridorPortalRelaxations: number
  corridorPortalExpansions: number
  corridorPortalPathEdges: number
  corridorDominanceWitnessChecks: number
  corridorDominanceSubsetChecks: number
  corridorDominanceIndexWork: number
  corridorDominanceSuppressed: number
  corridorOrientedSupports: number
  corridorOrientedIntervalChecks: number
  corridorIntervalBuilds: number
  corridorIntervalCacheHits: number
  corridorIntervalSearchChecks: number
  corridorIntervalSortChecks: number
  corridorRetainedIntervalLines: number
  corridorRetainedIntervals: number
  corridorGoalEventCacheHits: number
  corridorRetainedGoalEvents: number
  corridorHistoryMaskBuilds: number
  corridorHistoryMaskChecks: number
  corridorDominanceMaskRejections: number
  corridorExactEdgeCacheHits: number
  corridorExactEdgeCacheMisses: number
  corridorRetainedExactEdges: number
}
type CorridorSearchInput = {
  bounds: Bounds
  start: Point
  end: Point
  barriers: CorridorBarrier[]
  additionalCostSupports: ClearanceCostSupport[]
  grid: number
  layerCount: number
  wireReach: number
  traceThickness: number
  viaReach: number
  drillSpacing: number
  allowLayerChanges: boolean
  maxNodes: number
  heuristicWeight: number
  clear: (a: Point, b: Point) => boolean
  extraCost: (a: Point, b: Point) => number
  getPredicateWork?: () => number
  maximumPredicateWork?: number
  finish: (path: Point[] | null, nodes: number, reason: "found" | "no-path" | "node-limit", edgeChecks: number, stats: ClearanceCorridorStats) => void
}
type CorridorSearch = { step: () => void; nodeCount: number; maximumWork: number; stats: ClearanceCorridorStats }

/** An oriented rectangle encloses a capsule, including both rounded end caps. */
export function getClearanceCapsuleSupportOrientation(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): ClearanceSupportOrientation {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const padding = 64 * Number.EPSILON * Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y), radius, length)
  const cos = length === 0 ? 1 : (b.x - a.x) / length
  const sin = length === 0 ? 0 : (b.y - a.y) / length
  return { x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2,
    cos, sin, halfWidth: length / 2 + radius + padding, halfHeight: radius + padding }
}

/** Both bounding regions enclose real support; their intersection does too. */
function getSupportInterval(support: ClearanceCostSupport, point: Point, dx: number, dy: number, maximum: number): { enter: number; exit: number } | undefined {
  let enter = 0, exit = maximum
  const slabs: Array<readonly [number, number, number, number]> = [
    [point.x, dx, support.minX, support.maxX], [point.y, dy, support.minY, support.maxY],
  ]
  if (support.orientation) {
    const r = support.orientation
    const x = point.x - r.x, y = point.y - r.y
    slabs.push([x * r.cos + y * r.sin, dx * r.cos + dy * r.sin, -r.halfWidth, r.halfWidth],
      [-x * r.sin + y * r.cos, -dx * r.sin + dy * r.cos, -r.halfHeight, r.halfHeight])
  }
  for (const [origin, delta, min, max] of slabs) {
    if (delta === 0) {
      if (origin < min || origin > max) return undefined
    } else {
      const first = (min - origin) / delta, last = (max - origin) / delta
      enter = Math.max(enter, Math.min(first, last))
      exit = Math.min(exit, Math.max(first, last))
    }
  }
  return enter <= exit ? { enter, exit } : undefined
}

/**
 * Lazy obstacle-event runs over the native grid, not an all-pairs visibility
 * graph. Support boxes stop jumps, never reject local geometry. An empty run
 * exactly contracts collinear native edges with zero additional cost. Keeping
 * ordinary local successors preserves every grid turn and potential via site.
 */
export function createClearanceCorridorSearch(input: CorridorSearchInput): CorridorSearch {
  const { bounds, start, end, layerCount, grid } = input
  const coordinates = [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, start.x, start.y, end.x, end.y]
  if (!coordinates.every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) throw new Error("Clearance corridor coordinates and bounds must be finite with positive area")
  if (!Number.isSafeInteger(layerCount) || layerCount < 1 || ![start.z, end.z].every((z): boolean => Number.isSafeInteger(z) && z >= 0 && z < layerCount)) throw new Error("Clearance corridor anchors require valid copper layers")
  if (![input.wireReach, input.viaReach, input.drillSpacing, input.traceThickness, grid].every((reach): boolean => Number.isFinite(reach) && reach > 0) || !Number.isSafeInteger(input.maxNodes) || input.maxNodes < 1 || !Number.isFinite(input.heuristicWeight) || input.heuristicWeight < 1 || !Number.isSafeInteger(input.maximumPredicateWork ?? 0) || (input.maximumPredicateWork ?? 0) < 0) throw new Error("Clearance corridor search requires finite positive geometry and work limits")
  const nx = Math.floor((bounds.maxX - bounds.minX) / grid)
  const ny = Math.floor((bounds.maxY - bounds.minY) / grid)
  if (nx < 1 || ny < 1 || !Number.isSafeInteger(nx * ny * layerCount)) throw new Error("Clearance corridor grid must have a finite nonempty domain")
  if (grid <= Number.EPSILON * Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY))) throw new Error("Clearance corridor grid spacing is below coordinate precision")
  const supports: ClearanceCostSupport[] = []
  for (const barrier of input.barriers) {
    if (![barrier.minX, barrier.maxX, barrier.minY, barrier.maxY].every(Number.isFinite) || barrier.minX > barrier.maxX || barrier.minY > barrier.maxY) throw new Error("Clearance corridor barriers require finite ordered bounds")
    if (barrier.viaOnly) continue
    let orientation: ClearanceSupportOrientation | undefined
    if (barrier.rect && barrier.a) {
      const padding = 64 * Number.EPSILON * Math.max(1, Math.abs(barrier.a.x), Math.abs(barrier.a.y), barrier.rect.width, barrier.rect.height)
      orientation = { x: barrier.a.x, y: barrier.a.y, cos: Math.cos(barrier.rect.rotation), sin: Math.sin(barrier.rect.rotation),
        halfWidth: barrier.rect.width / 2 + input.wireReach + padding,
        halfHeight: barrier.rect.height / 2 + input.wireReach + padding }
    } else if (barrier.a && barrier.b && barrier.radius !== undefined) {
      orientation = getClearanceCapsuleSupportOrientation(barrier.a, barrier.b, barrier.radius + input.wireReach)
    }
    supports.push({ minX: barrier.minX - input.wireReach, maxX: barrier.maxX + input.wireReach,
      minY: barrier.minY - input.wireReach, maxY: barrier.maxY + input.wireReach,
      minZ: barrier.minZ ?? 0, maxZ: barrier.maxZ ?? layerCount - 1, orientation })
  }
  const hardSupportCount = supports.length
  for (const support of input.additionalCostSupports) supports.push(support)
  // Stop before the native goal-connector neighborhood rather than jumping
  // over it. This box is an event, not a collision or cost obstacle.
  supports.push({ minX: end.x - 3 * grid, maxX: end.x + 3 * grid,
    minY: end.y - 3 * grid, maxY: end.y + 3 * grid, minZ: 0, maxZ: layerCount - 1 })
  for (const support of supports) {
    if (![support.minX, support.maxX, support.minY, support.maxY, support.minZ, support.maxZ].every(Number.isFinite) ||
      support.minX > support.maxX || support.minY > support.maxY || !Number.isSafeInteger(support.minZ) || !Number.isSafeInteger(support.maxZ) || support.minZ < 0 || support.maxZ >= layerCount || support.minZ > support.maxZ) throw new Error("Clearance event support must have finite bounds and valid layers")
    if (support.orientation && (!Object.values(support.orientation).every(Number.isFinite) || support.orientation.halfWidth <= 0 || support.orientation.halfHeight <= 0 || Math.abs(Math.hypot(support.orientation.cos, support.orientation.sin) - 1) > 1e-12)) throw new Error("Oriented clearance support must be finite with orthonormal axes")
  }
  const degree = 21 + layerCount
  // Preserve native popped-node effort. Every generated edge, returned event,
  // history visit and index entry has separately counted maintenance capacity.
  // The virtual source tests up to 25 anchor connectors before the first pop.
  // Charge them independently of the original popped-state allowance.
  const maximumWork = input.barriers.length + supports.length * 4 + 128 +
    25 * (4 + (input.maximumPredicateWork ?? 0)) + input.maxNodes *
    (32 + degree * (4 + (input.maximumPredicateWork ?? 0)) + 9 * (2 * supports.length + 1) +
      (degree * 32 * 2 + degree + 3) * Math.min(nx * ny, input.maxNodes) + 128)
    + (input.maxNodes + 2) ** 2 + Math.min(4 * input.maxNodes, 3 * (nx + ny) * layerCount) *
      (supports.length ** 2 + supports.length * 3 + 8)
  if (!Number.isSafeInteger(maximumWork)) throw new Error("Clearance event work bound exceeds exact accounting range")
  const stats: ClearanceCorridorStats = {
    corridorWorkUnits: input.barriers.length + 2 * supports.length, corridorMaximumMaintenanceWork: maximumWork,
    corridorMaintenanceLimitReached: 0, corridorIndexEntries: 0,
    corridorEventQueries: 0, corridorEventCandidates: 0,
    corridorLocalEdgeChecks: 0, corridorGeneratedNeighbors: 0,
    corridorRunEdges: 0, corridorRunGridSteps: 0, corridorExpandedRunSteps: 0,
    corridorHistoryChecks: 0, corridorRetainedStates: 0,
    corridorNodesPopped: 0, corridorPortalEdges: 0,
    corridorPredicateWork: 0,
    corridorPortalRelaxations: 0, corridorPortalExpansions: 0, corridorPortalPathEdges: 0,
    corridorDominanceWitnessChecks: 0, corridorDominanceSubsetChecks: 0,
    corridorDominanceIndexWork: 0, corridorDominanceSuppressed: 0,
    corridorOrientedSupports: supports.filter((support) => support.orientation !== undefined).length,
    corridorOrientedIntervalChecks: 0,
    corridorIntervalBuilds: 0, corridorIntervalCacheHits: 0,
    corridorIntervalSearchChecks: 0, corridorIntervalSortChecks: 0,
    corridorRetainedIntervalLines: 0, corridorRetainedIntervals: 0,
    corridorGoalEventCacheHits: 0, corridorRetainedGoalEvents: 0,
    corridorHistoryMaskBuilds: 0, corridorHistoryMaskChecks: 0, corridorDominanceMaskRejections: 0,
    corridorExactEdgeCacheHits: 0, corridorExactEdgeCacheMisses: 0, corridorRetainedExactEdges: 0,
  }
  let index: Flatbush
  const states: State[] = []
  const byKey = new Map<string, State>()
  const witnesses = new Map<number, State[]>()
  const emptyHistoryWitnesses = new Map<number, State>()
  const singleHistoryWitnesses = new Map<number, Map<number, State>>()
  const lineIntervals = new Map<string, Interval[]>()
  const goalEvents = new Map<number, GoalEvent>()
  const historyMasks = new Map<string, HistoryMasks>()
  // The scene and endpoint-cost callbacks are fixed for this query. History
  // changes via eligibility, which is checked separately before relaxation.
  const exactEdgeCosts = new Map<number, Map<number, number>>()
  const heap = new ClearancePathHeap()
  let popped = 0, edgeChecks = 0, finished = false, popCheckpoint = false
  const point = (gridId: number): Point => ({
    x: bounds.minX + ((gridId % nx) + 0.5) * grid,
    y: bounds.minY + ((Math.floor(gridId / nx) % ny) + 0.5) * grid,
    z: Math.floor(gridId / (nx * ny)), traceThickness: input.traceThickness,
  })
  const estimate = (a: Point): number => {
    const planar = Math.hypot(a.x - end.x, a.y - end.y)
    const transition = a.z === end.z ? 0 : 1
    const distance = planar + transition
    return distance
  }
  const findState = (gridId: number, sites: number[], siteKey: string): State => {
    const key = `${gridId}|${siteKey}`
    const found = byKey.get(key)
    if (found) return found
    const state: State = { id: states.length, gridId, point: point(gridId), sites, siteKey, cost: Infinity, incomingRunSteps: 0, incomingPortal: false }
    states.push(state)
    byKey.set(key, state)
    return state
  }
  const getHistoryMasks = (state: State): HistoryMasks => {
    if (state.masks) return state.masks
    let masks = historyMasks.get(state.siteKey)
    if (!masks) {
      masks = { a: 0, b: 0 }
      for (const site of state.sites) {
        const hash = Math.imul(site ^ (site >>> 16), 0x9e3779b1)
        masks.a |= 1 << (hash & 31)
        masks.b |= 1 << ((hash >>> 5) & 31)
        stats.corridorHistoryMaskChecks++
        stats.corridorWorkUnits++
      }
      stats.corridorHistoryMaskBuilds++
      historyMasks.set(state.siteKey, masks)
    }
    state.masks = masks
    return masks
  }
  const dominated = function* (state: State, cost: number): Generator<void, boolean> {
    if (state.gridId < 0) return false
    stats.corridorDominanceIndexWork++
    yield
    const empty = emptyHistoryWitnesses.get(state.gridId)
    if (empty) stats.corridorDominanceWitnessChecks++
    if (empty && empty !== state && empty.cost <= cost) return true
    const singles = singleHistoryWitnesses.get(state.gridId)
    for (const site of state.sites) {
      stats.corridorDominanceIndexWork++
      yield
      const single = singles?.get(site)
      if (single) stats.corridorDominanceWitnessChecks++
      if (single && single !== state && single.cost <= cost) return true
    }
    for (const witness of witnesses.get(state.gridId) ?? []) {
      stats.corridorDominanceWitnessChecks++
      yield
      if (witness === state || witness.cost > cost || witness.sites.length > state.sites.length) continue
      const left = getHistoryMasks(witness), right = getHistoryMasks(state)
      if ((left.a & right.a) !== left.a || (left.b & right.b) !== left.b) {
        stats.corridorDominanceMaskRejections++
        continue
      }
      let cursor = 0, subset = true
      for (const site of witness.sites) {
        while (cursor < state.sites.length && state.sites[cursor]! < site) {
          stats.corridorDominanceSubsetChecks++
          yield
          cursor++
        }
        stats.corridorDominanceSubsetChecks++
        yield
        if (state.sites[cursor] !== site) { subset = false; break }
      }
      if (subset) return true
    }
    return false
  }
  const relax = function* (from: State, to: State, certifiedEmpty: boolean, runSteps = 0, portal = false): Generator<void> {
    stats.corridorGeneratedNeighbors++
    yield
    const via = from.point.z !== to.point.z
    const base = via ? 1 : Math.hypot(from.point.x - to.point.x, from.point.y - to.point.y)
    if (!via && base === 0 && from.gridId >= 0 && to.gridId >= 0 && from.gridId !== to.gridId) throw new Error("Clearance event grid step collapsed at coordinate precision")
    if (from.cost + base >= to.cost) return
    // This query has fixed costs. A cheaper expanded prefix at the same XYZ
    // with fewer prior drill sites can realize every remaining continuation.
    if (yield* dominated(to, from.cost + base)) {
      stats.corridorDominanceSuppressed++
      return
    }
    let extra = 0
    if (!certifiedEmpty) {
      let column = exactEdgeCosts.get(from.gridId)
      const cached = column?.get(to.gridId)
      yield
      if (cached !== undefined) {
        stats.corridorExactEdgeCacheHits++
        extra = cached
      } else {
        stats.corridorExactEdgeCacheMisses++
        stats.corridorLocalEdgeChecks++
        edgeChecks++
        const before = input.getPredicateWork?.() ?? 0
        const clear = input.clear(from.point, to.point)
        extra = clear ? input.extraCost(from.point, to.point) : Infinity
        const work = (input.getPredicateWork?.() ?? 0) - before
        if (!Number.isSafeInteger(work) || work < 0) throw new Error("Clearance predicate work must be a nonnegative exact count")
        stats.corridorPredicateWork += work
        stats.corridorWorkUnits += work
        if (Number.isNaN(extra) || extra < 0) throw new Error("Clearance event edge cost must be nonnegative")
        if (!column) { column = new Map<number, number>(); exactEdgeCosts.set(from.gridId, column) }
        column.set(to.gridId, extra)
        stats.corridorRetainedExactEdges++
      }
    }
    const cost = from.cost + base + extra
    if (!Number.isFinite(cost) || cost >= to.cost) return
    to.cost = cost
    to.parent = from
    to.incomingRunSteps = runSteps
    to.incomingPortal = portal
    if (portal) stats.corridorPortalRelaxations++
    heap.push({ id: to.id, cost, priority: cost + input.heuristicWeight * estimate(to.point) })
  }
  const emptyRun = function* (a: State, dx: number, dy: number, maximum: number): Generator<void, number> {
    if (maximum < 2) return 1
    const x = a.gridId % nx, y = Math.floor(a.gridId / nx) % ny
    let vx = 1, vy = 0, bx = 0, by = y, minimum = 0, limit = nx - 1, current = x
    if (dx === 0) {
      vx = 0; vy = 1; bx = x; by = 0; limit = ny - 1; current = y
    } else if (dy !== 0) {
      vy = dx === dy ? 1 : -1
      by = vy === 1 ? y - x : y + x
      minimum = Math.max(0, vy === 1 ? -by : by - ny + 1)
      limit = Math.min(nx - 1, vy === 1 ? ny - 1 - by : by)
    }
    const key = `${a.point.z}:${vx}:${vy}:${bx}:${by}`
    let intervals = lineIntervals.get(key)
    if (intervals) {
      stats.corridorIntervalCacheHits++
      yield
    } else {
      const base: Point = { x: bounds.minX + (bx + 0.5) * grid,
        y: bounds.minY + (by + 0.5) * grid, z: a.point.z }
      if (!Number.isFinite(base.x) || !Number.isFinite(base.y)) throw new Error("Clearance scanline exceeds finite coordinate range")
      const first = { x: base.x + minimum * vx * grid, y: base.y + minimum * vy * grid }
      const last = { x: base.x + limit * vx * grid, y: base.y + limit * vy * grid }
      stats.corridorEventQueries++
      stats.corridorIntervalBuilds++
      yield
      const candidates = index.search(Math.min(first.x, last.x), Math.min(first.y, last.y), Math.max(first.x, last.x), Math.max(first.y, last.y))
      const fragments: Interval[] = []
      for (const id of candidates) {
        stats.corridorEventCandidates++
        yield
        const support = supports[id]!
        if (a.point.z < support.minZ || a.point.z > support.maxZ) continue
        if (support.orientation) stats.corridorOrientedIntervalChecks++
        const interval = getSupportInterval(support, base, vx * grid, vy * grid, limit)
        if (interval && interval.exit >= minimum) fragments.push({ enter: Math.max(minimum, interval.enter), exit: interval.exit })
      }
      fragments.sort((left, right): number => {
        stats.corridorIntervalSortChecks++
        stats.corridorWorkUnits++
        return left.enter - right.enter || left.exit - right.exit
      })
      intervals = []
      for (const fragment of fragments) {
        yield
        const previous = intervals.at(-1)
        if (previous && fragment.enter <= previous.exit) previous.exit = Math.max(previous.exit, fragment.exit)
        else intervals.push({ ...fragment })
      }
      lineIntervals.set(key, intervals)
      stats.corridorRetainedIntervalLines = lineIntervals.size
      stats.corridorRetainedIntervals += intervals.length
    }
    const forward = dx === vx && dy === vy
    let lo = 0, hi = intervals.length
    while (lo < hi) {
      const middle = Math.floor((lo + hi) / 2)
      stats.corridorIntervalSearchChecks++
      yield
      if (forward ? intervals[middle]!.exit < current : intervals[middle]!.enter <= current) lo = middle + 1
      else hi = middle
    }
    const next = intervals[forward ? lo : lo - 1]
    if (!next) return maximum
    const distance = forward ? next.enter - current : current - next.exit
    return Math.min(maximum, Math.max(1, Math.ceil(distance) - 1))
  }
  const firstBlockingSupport = function* (a: Point, gridId: number): Generator<void, GoalEvent> {
    const cached = goalEvents.get(gridId)
    if (cached) { stats.corridorGoalEventCacheHits++; yield; return cached }
    stats.corridorEventQueries++
    yield
    const candidates = index.search(Math.min(a.x, end.x), Math.min(a.y, end.y), Math.max(a.x, end.x), Math.max(a.y, end.y))
    let nearest = Infinity
    let found: ClearanceCostSupport | undefined
    let hardSupportCrossed = false
    for (const id of candidates) {
      stats.corridorEventCandidates++
      yield
      if (id === supports.length - 1) continue
      const support = supports[id]!
      if (a.z < support.minZ || a.z > support.maxZ) continue
      // An active support is handled with local geometry. Only its first
      // exterior boundary offers a meaningful visibility portal.
      if (support.orientation) stats.corridorOrientedIntervalChecks++
      const interval = getSupportInterval(support, a, end.x - a.x, end.y - a.y, 1)
      if (interval) {
        if (id < hardSupportCount) hardSupportCrossed = true
        if (interval.enter > 0 && interval.enter < nearest) { nearest = interval.enter; found = support }
      }
    }
    const value = { blocker: found, hardSupportCrossed }
    goalEvents.set(gridId, value)
    stats.corridorRetainedGoalEvents = goalEvents.size
    return value
  }
  const computation = function* (): Generator<void, Point[] | null> {
    index = new Flatbush(supports.length)
    for (const support of supports) {
      index.add(support.minX, support.minY, support.maxX, support.maxY)
      stats.corridorIndexEntries++
      yield
    }
    index.finish()
    const source: State = { id: states.length, gridId: -1, point: start, sites: [], siteKey: "", cost: 0, incomingRunSteps: 0, incomingPortal: false }
    states.push(source)
    const goal: State = { id: states.length, gridId: -2, point: end, sites: [], siteKey: "", cost: Infinity, incomingRunSteps: 0, incomingPortal: false }
    states.push(goal)
    const sx = Math.max(0, Math.min(nx - 1, Math.floor((start.x - bounds.minX) / grid)))
    const sy = Math.max(0, Math.min(ny - 1, Math.floor((start.y - bounds.minY) / grid)))
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const x = sx + dx, y = sy + dy
      if (x < 0 || x >= nx || y < 0 || y >= ny) continue
      yield* relax(source, findState((start.z * ny + y) * nx + x, [], ""), false)
    }
    while (heap.length) {
      popCheckpoint = true
      yield
      popCheckpoint = false
      const current = heap.pop()
      popped++
      stats.corridorNodesPopped = popped
      yield
      const a = states[current.id]!
      if (current.cost !== a.cost) continue
      if (yield* dominated(a, a.cost)) { stats.corridorDominanceSuppressed++; continue }
      stats.corridorExpandedRunSteps += a.incomingRunSteps
      if (a.incomingPortal) stats.corridorPortalExpansions++
      if (a === goal) {
        const path: Point[] = []
        for (let cursor: State | undefined = goal; cursor; cursor = cursor.parent) {
          path.push({ ...cursor.point })
          if (cursor.incomingPortal) stats.corridorPortalPathEdges++
          yield
        }
        path.reverse()
        // Collinear contraction is a union of already proved segments. It
        // cannot introduce new copper or remove any layer transition.
        const compact: Point[] = []
        for (const p of path) {
          const first = compact.at(-2), second = compact.at(-1)
          if (first && second && first.z === second.z && second.z === p.z &&
            (second.x - first.x) * (p.y - second.y) === (second.y - first.y) * (p.x - second.x) &&
            (second.x - first.x) * (p.x - second.x) + (second.y - first.y) * (p.y - second.y) >= 0) compact.pop()
          compact.push(p)
          yield
        }
        return compact
      }
      const x = a.gridId % nx, y = Math.floor(a.gridId / nx) % ny
      const visibility = yield* firstBlockingSupport(a.point, a.gridId)
      const blocker = visibility.blocker
      if (blocker) {
        const portals: Array<{ x: number; y: number }> = []
        if (blocker.orientation) {
          const r = blocker.orientation
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) portals.push({
            x: r.x + sx * r.halfWidth * r.cos - sy * r.halfHeight * r.sin,
            y: r.y + sx * r.halfWidth * r.sin + sy * r.halfHeight * r.cos,
          })
        } else for (const x of [blocker.minX, blocker.maxX]) for (const y of [blocker.minY, blocker.maxY]) portals.push({ x, y })
        for (const portal of portals) {
          const px = Math.round((portal.x - bounds.minX) / grid - 0.5)
          const py = Math.round((portal.y - bounds.minY) / grid - 0.5)
          if (px < 0 || px >= nx || py < 0 || py >= ny || px === x && py === y) continue
          stats.corridorPortalEdges++
          yield* relax(a, findState((a.point.z * ny + py) * nx + px, a.sites, a.siteKey), false, 0, true)
        }
      }
      // A direct arbitrary-angle connector is an exact geometric query, not a
      // claim that the intervening support boxes are empty.
      if (a.point.z === end.z && !visibility.hardSupportCrossed) yield* relax(a, goal, false)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        const maximum = Math.min(dx > 0 ? nx - 1 - x : dx < 0 ? x : Infinity,
          dy > 0 ? ny - 1 - y : dy < 0 ? y : Infinity)
        if (maximum < 1) continue
        const steps = yield* emptyRun(a, dx, dy, maximum)
        if (steps > 1) {
          stats.corridorRunEdges++
          stats.corridorRunGridSteps += steps
          yield* relax(a, findState((a.point.z * ny + y + dy * steps) * nx + x + dx * steps, a.sites, a.siteKey), true, steps)
        }
        yield* relax(a, findState((a.point.z * ny + y + dy) * nx + x + dx, a.sites, a.siteKey), false)
      }
      if (input.allowLayerChanges) {
        const site = a.gridId % (nx * ny)
        let legal = true, alreadyDrilled = false, insertion = 0
        for (const previous of a.sites) {
          stats.corridorHistoryChecks++
          yield
          if (previous === site) alreadyDrilled = true
          else if (Math.hypot(x - previous % nx, y - Math.floor(previous / nx)) * grid + REGION_EPSILON < input.drillSpacing) legal = false
          if (previous < site) insertion++
        }
        if (legal) {
          const sites = alreadyDrilled ? a.sites : [...a.sites]
          if (!alreadyDrilled) sites.splice(insertion, 0, site)
          const siteKey = sites.join(",")
          for (let z = 0; z < layerCount; z++) {
            if (z === a.point.z) continue
            yield* relax(a, findState((z * ny + y) * nx + x, sites, siteKey), false)
          }
        }
      }
      if (a.point.z === end.z && Math.hypot(a.point.x - end.x, a.point.y - end.y) < grid * 3) yield* relax(a, goal, false)
      if (a.sites.length < 2) {
        stats.corridorDominanceIndexWork++
        yield
        if (a.sites.length === 0) emptyHistoryWitnesses.set(a.gridId, a)
        else {
          let singles = singleHistoryWitnesses.get(a.gridId)
          if (!singles) { singles = new Map<number, State>(); singleHistoryWitnesses.set(a.gridId, singles) }
          singles.set(a.sites[0]!, a)
        }
        continue
      }
      const candidates = witnesses.get(a.gridId) ?? []
      if (!candidates.includes(a)) candidates.push(a)
      if (candidates.length > 32) {
        let worst = 0
        for (let i = 1; i < candidates.length; i++) {
          stats.corridorDominanceIndexWork++
          yield
          const left = candidates[i]!, right = candidates[worst]!
          if (left.sites.length > right.sites.length || left.sites.length === right.sites.length && left.cost > right.cost) worst = i
        }
        candidates.splice(worst, 1)
      }
      witnesses.set(a.gridId, candidates)
    }
    return null
  }()
  const step = (): void => {
    if (finished) throw new Error("Clearance corridor search stepped after completion")
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
  return { step, nodeCount: nx * ny * layerCount, maximumWork, stats }
}

/** Add measured work while keeping query capacity and high-water marks maxima. */
export function mergeClearanceCorridorStats(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("corridor") || key === "corridorEdgeChecks" || key === "corridorSearchCalls") continue
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid event work counter ${key}`)
    const previous = target[key]
    if (previous !== undefined && typeof previous !== "number") throw new Error(`Event work counter ${key} changed type`)
    const prior = previous === undefined ? 0 : previous as number
    target[key] = key === "corridorMaximumMaintenanceWork" || key.startsWith("corridorRetained")
      ? Math.max(prior, value) : prior + value
  }
}
