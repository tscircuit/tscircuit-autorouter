import type { DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"

export type GlobalOwnerDistanceWork = {
  globalExpandedLabels: number; globalHopVisits: number; globalOwnerUnionVisits: number
  globalDominanceTests: number; globalSubsetOwnerChecks: number; globalAllocatedLabels: number
  globalQueuePushes: number; globalQueuePops: number; globalQueueComparisons: number
  globalLabelLimitHits: number; globalPeakQueueSize: number; globalPeakStateLabels: number
}
export type GlobalOwnerDistanceOptions<S, K, O, D> = {
  start: S; minimumOwners: number; getStateKey(state: S): K; isGoal(state: S): boolean
  getHops(state: S): DistinctOwnerBlockerHop<S, O, D>[] | undefined
  /** Canonical ascending, distinct numeric IDs; stable for this immutable query. */
  getOwnerIds(hop: DistinctOwnerBlockerHop<S, O, D>): readonly number[] | undefined
  work: GlobalOwnerDistanceWork
  maximumAllocatedLabels?: number
  charge(field: keyof GlobalOwnerDistanceWork, units?: number): boolean
}
export type GlobalOwnerDistanceResult<S, O, D> =
  | { found: true; states: S[]; hops: DistinctOwnerBlockerHop<S, O, D>[]; distance: number }
  | { found: false; reason: "expansion_limit" }
type Label<S, O, D> = {
  state: S; owners: readonly number[]; distance: number; order: number; active: boolean
  previous: Label<S, O, D> | null; hop: DistinctOwnerBlockerHop<S, O, D> | null
}

/** A separate finite storage limit; reaching it is unknown, never disconnection. */
export const GLOBAL_OWNER_DISTANCE_LABEL_LIMIT = 1000000

class OwnerDistanceQueue<S, O, D> {
  readonly entries: Label<S, O, D>[] = []
  constructor(private charge: GlobalOwnerDistanceOptions<S, unknown, O, D>["charge"]) {}

  private less(a: Label<S, O, D>, b: Label<S, O, D>): boolean {
    if (!this.charge("globalQueueComparisons")) return false
    if (a.distance !== b.distance) return a.distance < b.distance
    // Fixed proven minimum cardinality makes distance the PRIMARY queue key.
    // Stable occurrence ties are local to this queue, not native parity claims.
    return a.order < b.order
  }

  push(label: Label<S, O, D>): void {
    let index = this.entries.length
    this.entries.push(label)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (!this.less(label, this.entries[parent]!)) break
      this.entries[index] = this.entries[parent]!
      index = parent
    }
    this.entries[index] = label
  }

  pop(): Label<S, O, D> | undefined {
    const first = this.entries[0], last = this.entries.pop()
    if (!last || this.entries.length === 0) return first
    let index = 0
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1
      if (child + 1 < this.entries.length && this.less(this.entries[child + 1]!, this.entries[child]!)) child++
      if (!this.less(this.entries[child]!, last)) break
      this.entries[index] = this.entries[child]!
      index = child
    }
    this.entries[index] = last
    return first
  }
}

/**
 * After an independent proof that minimum owner cardinality is k, distance-only
 * Dijkstra over (directed state, owner set) finds the global shortest path with
 * <=k owners. It does not run one search per candidate owner set. At one state,
 * A dominates B ONLY when A.owners is a subset AND A.distance<=B.distance.
 * Fewer owners alone or a node-only closed set would be unsound here.
 *
 * Owner arrays/parents/hops never mutate after allocation; retiring an active
 * label cannot alter its descendants' witnesses. Native adjacency/owner IDs and
 * nonnegative distances remain immutable during the query. All work shares the
 * caller's remaining budget, with no reset after the cardinality proof.
 */
export function findGlobalOwnerBoundedDistance<S, K, O, D>(
  options: GlobalOwnerDistanceOptions<S, K, O, D>,
): GlobalOwnerDistanceResult<S, O, D> {
  if (!Number.isSafeInteger(options.minimumOwners) || options.minimumOwners < 0) throw new Error("A proved finite owner cardinality is required")
  const labelLimit = options.maximumAllocatedLabels ?? GLOBAL_OWNER_DISTANCE_LABEL_LIMIT
  if (!Number.isSafeInteger(labelLimit) || labelLimit < 0 || labelLimit > GLOBAL_OWNER_DISTANCE_LABEL_LIMIT) {
    throw new Error("Global owner-distance label limit must not exceed its fixed storage policy")
  }
  let limited = false, order = 0
  const charge = (field: keyof GlobalOwnerDistanceWork, units = 1): boolean => {
    if (!options.charge(field, units)) limited = true
    // A failed heap comparison may leave a partial heap operation, but no
    // label/result is consumed after exhaustion; the whole refinement is UNKNOWN.
    // No partial graph or tentative answer becomes a successful path.
    return !limited
  }
  const queue = new OwnerDistanceQueue<S, O, D>(charge)
  const byState = new Map<K, Label<S, O, D>[]>()
  const subset = (a: readonly number[], b: readonly number[]): boolean => {
    if (a.length > b.length) return false
    let second = 0
    for (const owner of a) {
      while (second < b.length && b[second]! < owner) {
        if (!charge("globalSubsetOwnerChecks")) return false
        second++
      }
      if (!charge("globalSubsetOwnerChecks")) return false
      if (b[second] !== owner) return false
    }
    return true
  }
  const union = (a: readonly number[], b: readonly number[]): readonly number[] | null => {
    if (b.length === 0) return a
    const joined: number[] = []
    let first = 0, second = 0
    while (first < a.length || second < b.length) {
      if (!charge("globalOwnerUnionVisits")) return null
      const one = a[first], two = b[second]
      if (two === undefined || (one !== undefined && one < two)) { joined.push(one!); first++ }
      else if (one === undefined || two < one) { joined.push(two); second++ }
      else { joined.push(one); first++; second++ }
      if (joined.length > options.minimumOwners) return null
    }
    return joined
  }
  const enqueue = (label: Label<S, O, D>, survivors: Label<S, O, D>[]): boolean => {
    if (options.work.globalAllocatedLabels >= labelLimit) {
      charge("globalLabelLimitHits")
      limited = true
      return false
    }
    if (!charge("globalAllocatedLabels") || !charge("globalQueuePushes")) return false
    survivors.push(label)
    byState.set(options.getStateKey(label.state), survivors)
    queue.push(label)
    options.work.globalPeakQueueSize = Math.max(options.work.globalPeakQueueSize, queue.entries.length)
    options.work.globalPeakStateLabels = Math.max(options.work.globalPeakStateLabels, survivors.length)
    return !limited
  }
  if (!enqueue({ state: options.start, owners: [], distance: 0, order: order++, active: true, previous: null, hop: null }, [])) {
    return { found: false, reason: "expansion_limit" }
  }
  while (true) {
    if (!charge("globalQueuePops")) return { found: false, reason: "expansion_limit" }
    const current = queue.pop()
    if (limited) return { found: false, reason: "expansion_limit" }
    if (!current) throw new Error("Immutable global owner-distance graph lost its independently proved path")
    if (!current.active) continue
    if (options.isGoal(current.state)) {
      if (current.owners.length !== options.minimumOwners) throw new Error("Global owner-distance path contradicts minimum-cardinality proof")
      const states: S[] = [], hops: DistinctOwnerBlockerHop<S, O, D>[] = []
      let cursor: Label<S, O, D> | null = current
      while (cursor) {
        states.push(cursor.state)
        if (cursor.hop) hops.push(cursor.hop)
        cursor = cursor.previous
      }
      states.reverse(); hops.reverse()
      return { found: true, states, hops, distance: current.distance }
    }
    if (!charge("globalExpandedLabels")) return { found: false, reason: "expansion_limit" }
    const outgoing = options.getHops(current.state)
    if (!outgoing) return { found: false, reason: "expansion_limit" }
    for (const hop of outgoing) {
      if (!charge("globalHopVisits")) return { found: false, reason: "expansion_limit" }
      if (!Number.isFinite(hop.distance) || hop.distance < 0) throw new Error("Global owner-distance hops require finite nonnegative distances")
      const added = options.getOwnerIds(hop)
      if (!added) return { found: false, reason: "expansion_limit" }
      const owners = union(current.owners, added)
      if (limited) return { found: false, reason: "expansion_limit" }
      if (!owners) continue
      const distance = current.distance + hop.distance
      if (!Number.isFinite(distance)) throw new Error("Global owner-distance path distance overflowed")
      const existing = byState.get(options.getStateKey(hop.state))
      let dominated = false
      if (existing) for (const label of existing) {
        if (!charge("globalDominanceTests")) return { found: false, reason: "expansion_limit" }
        if (label.distance <= distance && subset(label.owners, owners)) { dominated = true; break }
      }
      if (limited) return { found: false, reason: "expansion_limit" }
      if (dominated) continue
      const survivors: Label<S, O, D>[] = []
      if (existing) for (const label of existing) {
        if (!charge("globalDominanceTests")) return { found: false, reason: "expansion_limit" }
        if (distance <= label.distance && subset(owners, label.owners)) label.active = false
        else survivors.push(label)
      }
      if (limited) return { found: false, reason: "expansion_limit" }
      if (!enqueue({ state: hop.state, owners, distance, order: order++, active: true, previous: current, hop }, survivors)) {
        return { found: false, reason: "expansion_limit" }
      }
    }
  }
}
