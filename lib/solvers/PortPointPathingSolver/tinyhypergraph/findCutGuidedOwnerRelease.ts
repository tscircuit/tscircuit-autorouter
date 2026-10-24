import type {
  DistinctOwnerBlockerHop,
  DistinctOwnerBlockerSearchOptions,
  DistinctOwnerBlockerSearchResult,
} from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { buildOwnerCutCondensation } from "./buildOwnerCutCondensation"

export type OwnerCutWork = {
  oracleCalls: number
  oracleExpandedStates: number
  oracleHopVisits: number
  ownerMembershipChecks: number
  masterExpandedStates: number
  masterTermChecks: number
  masterUnionVisits: number
  cutBoundaryVisits: number
  cutOwnerVisits: number
  condensationStates: number
  condensationHopVisits: number
  condensationOwnerVisits: number
  condensationArcVisits: number
  componentExpandedStates: number
  componentHopVisits: number
  componentOracleCalls: number
  componentCount: number
  condensedArcCount: number
  rawConditionalArcCount: number
  singletonTermVisits: number
  singletonIntersectionVisits: number
  singletonChoiceVisits: number
  learnedCuts: number
  learnedTerms: number
  connectedOwnerChoices: number
  workUnits: number
}

export type OwnerCutOptions<S, K, O, D = unknown> =
  Pick<DistinctOwnerBlockerSearchOptions<S, K, O, D>, "start" | "getStateKey" | "isGoal" | "getHops"> & {
    /** Includes oracle hops, owner tests, and master work, not elapsed time. */
    maxWorkUnits: number
  }

export type OwnerCutResult<S, O, D = unknown> = {
  result: DistinctOwnerBlockerSearchResult<S, O, D>
  work: OwnerCutWork
  ownerMinimumProven: boolean
  distanceMinimumProven: boolean
}

type Entry<S, D, O> = {
  state: S
  distance: number
  order: number
  parent: Entry<S, D, O> | null
  hop: DistinctOwnerBlockerHop<S, O, D> | null
}

type Oracle<S, D, O> = {
  goal: Entry<S, D, O> | null
  cut: number[][]
  limited: boolean
}

/** Stable distance queue: equal costs retain native hop occurrence order. */
class DistanceQueue<S, D, O> {
  private entries: Entry<S, D, O>[] = []

  private less(a: Entry<S, D, O>, b: Entry<S, D, O>): boolean {
    if (a.distance !== b.distance) return a.distance < b.distance
    // A distance is accumulated in the original directed-hop order.
    // This secondary key changes neither arithmetic nor equal-cost priority.
    // Parallel edges and duplicate occurrences remain separate insertions.
    return a.order < b.order
  }

  push(entry: Entry<S, D, O>): void {
    let index = this.entries.length
    this.entries.push(entry)
    while (index > 0) {
      const parent = (index - 1) >>> 1
      if (!this.less(entry, this.entries[parent]!)) break
      this.entries[index] = this.entries[parent]!
      index = parent
    }
    this.entries[index] = entry
  }

  pop(): Entry<S, D, O> | undefined {
    const first = this.entries[0]
    const last = this.entries.pop()
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
 * Exact owner-once minimum, then shortest distance on stable directed hops.
 * A failed reachability query learns OR_hop(AND_owner released(owner)).
 * Flattening this expression to an OR of owners would be unsound.
 *
 * A connected minimum-cardinality choice alone does not prove minimum distance.
 * We also exhaust the remaining minimum-cardinality choices. Reachability uses
 * the zero-owner SCC quotient; only connected choices need original-hop Dijkstra.
 * All cold quotient construction and secondary searches share the work budget.
 * A work cap returns expansion_limit, never a finite-model infeasibility claim.
 */
export function findCutGuidedOwnerRelease<S, K, O, D = unknown>(
  options: OwnerCutOptions<S, K, O, D>,
): OwnerCutResult<S, O, D> {
  if (!Number.isSafeInteger(options.maxWorkUnits) || options.maxWorkUnits < 0) {
    throw new Error("Owner-cut maxWorkUnits must be a non-negative safe integer")
  }
  const work: OwnerCutWork = {
    oracleCalls: 0, oracleExpandedStates: 0, oracleHopVisits: 0,
    ownerMembershipChecks: 0, masterExpandedStates: 0, masterTermChecks: 0,
    masterUnionVisits: 0, learnedCuts: 0, learnedTerms: 0,
    cutBoundaryVisits: 0, cutOwnerVisits: 0,
    condensationStates: 0, condensationHopVisits: 0,
    condensationOwnerVisits: 0, condensationArcVisits: 0,
    componentExpandedStates: 0, componentHopVisits: 0,
    componentOracleCalls: 0, componentCount: 0,
    condensedArcCount: 0, rawConditionalArcCount: 0,
    singletonTermVisits: 0, singletonIntersectionVisits: 0,
    singletonChoiceVisits: 0,
    connectedOwnerChoices: 0, workUnits: 0,
  }
  const ownerIds = new Map<O, number>()
  const ownerValues: O[] = []
  const cuts: number[][][] = []
  let singletonOwners: Set<number> | null = null
  const testedChoices = new Set<string>()
  const cachedHops = new Map<K, DistinctOwnerBlockerHop<S, O, D>[]>()
  const hopOwners = new WeakMap<object, number[]>()
  let limited = false

  const charge = (field: keyof OwnerCutWork): boolean => {
    if (work.workUnits >= options.maxWorkUnits) {
      limited = true
      return false
    }
    work.workUnits++
    work[field]++
    return true
  }
  const choiceKey = (owners: ReadonlySet<number>): string => {
    const ordered = [...owners]
    ordered.sort((a, b): number => a - b)
    // IDs are allocated once per synchronous immutable query.
    // Keys describe owner identity, never mutable route geometry.
    // Multiplicity of an owner on one or many hops is immaterial.
    return ordered.join(",")
  }
  const getHops = (state: S): DistinctOwnerBlockerHop<S, O, D>[] => {
    const key = options.getStateKey(state)
    const known = cachedHops.get(key)
    if (known) return known
    const hops = [...options.getHops(state)]
    cachedHops.set(key, hops)
    return hops
  }
  const getOwners = (hop: DistinctOwnerBlockerHop<S, O, D>): number[] => {
    const known = hopOwners.get(hop)
    if (known) return known
    const ids = new Set<number>()
    for (const owner of hop.owners ?? []) {
      let id = ownerIds.get(owner)
      if (id === undefined) {
        id = ownerValues.length
        ownerIds.set(owner, id)
        ownerValues.push(owner)
      }
      ids.add(id)
    }
    const result = [...ids]
    hopOwners.set(hop, result)
    return result
  }
  const oracle = (released: ReadonlySet<number>): Oracle<S, D, O> => {
    work.oracleCalls++
    const queue = new DistanceQueue<S, D, O>()
    const best = new Map<K, number>([[options.getStateKey(options.start), 0]])
    const reached = new Set<K>()
    const blocked: Array<{ to: K; owners: number[] }> = []
    let order = 0
    const first: Entry<S, D, O> = { state: options.start, distance: 0, order: order++, parent: null, hop: null }
    queue.push(first)
    while (true) {
      const current = queue.pop()
      if (!current) break
      const currentKey = options.getStateKey(current.state)
      if (current.distance !== best.get(currentKey) || reached.has(currentKey)) continue
      if (options.isGoal(current.state)) return { goal: current, cut: [], limited: false }
      if (!charge("oracleExpandedStates")) return { goal: null, cut: [], limited: true }
      reached.add(currentKey)
      for (const hop of getHops(current.state)) {
        if (!charge("oracleHopVisits")) return { goal: null, cut: [], limited: true }
        if (!Number.isFinite(hop.distance) || hop.distance < 0) {
          throw new Error("Owner-cut hops require finite distances >= 0")
        }
        const ids = getOwners(hop)
        let permitted = true
        for (const owner of ids) {
          if (!charge("ownerMembershipChecks")) return { goal: null, cut: [], limited: true }
          if (!released.has(owner)) { permitted = false; break }
        }
        const to = options.getStateKey(hop.state)
        if (!permitted) { blocked.push({ to, owners: ids }); continue }
        const distance = current.distance + hop.distance
        if (!Number.isFinite(distance)) throw new Error("Owner-cut path distance overflowed")
        if (distance >= (best.get(to) ?? Infinity)) continue
        best.set(to, distance)
        const entry: Entry<S, D, O> = { state: hop.state, distance, order: order++, parent: current, hop }
        queue.push(entry)
      }
    }
    // Only directed edges leaving the fully reached set form a valid cut.
    const uniqueTerms = new Map<string, number[]>()
    for (const edge of blocked) {
      if (!charge("cutBoundaryVisits")) return { goal: null, cut: [], limited: true }
      if (reached.has(edge.to)) continue
      const term = [...edge.owners].sort((a, b): number => a - b)
      for (const _owner of term) {
        if (!charge("cutOwnerVisits")) return { goal: null, cut: [], limited: true }
      }
      // Many distinct crossing hops have the same owner conjunction. Boolean
      // idempotence removes repeated terms without changing the learned cut.
      uniqueTerms.set(term.join(","), term)
    }
    return { goal: null, cut: [...uniqueTerms.values()], limited: false }
  }
  const pathOwners = (goal: Entry<S, D, O>): Set<number> => {
    const owners = new Set<number>()
    let entry: Entry<S, D, O> | null = goal
    while (entry) {
      if (entry.hop) for (const id of getOwners(entry.hop)) owners.add(id)
      entry = entry.parent
    }
    return owners
  }
  const master = (ceiling: number): Set<number> | undefined => {
    // For a one-owner assignment a conjunction is true iff it is exactly that
    // singleton. Intersecting the singleton terms of every cut is therefore an
    // exact cardinality-one master, not a heuristic owner preference.
    if (singletonOwners && singletonOwners.size > 0) {
      for (const owner of singletonOwners) {
        if (!charge("singletonChoiceVisits")) return undefined
        if (!testedChoices.has(String(owner))) return new Set([owner])
      }
      return undefined
    }
    const pending: Set<number>[] = [new Set()]
    const seen = new Set<string>()
    let candidate: Set<number> | undefined
    let bestSize = ceiling + 1
    while (pending.length > 0) {
      if (!charge("masterExpandedStates")) return undefined
      const selected = pending.pop()!
      if (selected.size >= bestSize || selected.size > ceiling) continue
      const key = choiceKey(selected)
      if (seen.has(key)) continue
      seen.add(key)
      let unsatisfied: number[][] | undefined
      for (const cut of cuts) {
        let satisfied = false
        for (const term of cut) {
          if (!charge("masterTermChecks")) return undefined
          if (term.every((owner): boolean => selected.has(owner))) { satisfied = true; break }
        }
        if (!satisfied && (!unsatisfied || cut.length < unsatisfied.length)) unsatisfied = cut
      }
      if (!unsatisfied) {
        // Every feasible owner set contains a generated minimal cut satisfier.
        // A disconnected tested choice is excluded by its next necessary cut.
        // A connected tested choice updates the cardinality ceiling. Therefore
        // no ungenerated strict superset can improve this incumbent: equal-size
        // alternatives are generated themselves; larger supersets cannot win.
        if (!testedChoices.has(key)) { candidate = selected; bestSize = selected.size }
        continue
      }
      for (let index = unsatisfied.length - 1; index >= 0; index--) {
        const next = new Set(selected)
        for (const owner of unsatisfied[index]!) {
          if (!charge("masterUnionVisits")) return undefined
          next.add(owner)
        }
        if (next.size < bestSize && next.size <= ceiling) pending.push(next)
      }
    }
    return candidate
  }
  const finish = (goal: Entry<S, D, O> | null, noPath: boolean): OwnerCutResult<S, O, D> => {
    if (!goal || limited) {
      return { result: { found: false, reason: noPath && !limited ? "no_path" : "expansion_limit", expandedLabelCount: work.oracleExpandedStates }, work, ownerMinimumProven: false, distanceMinimumProven: false }
    }
    const states: S[] = []
    const hops: DistinctOwnerBlockerHop<S, O, D>[] = []
    let cursor: Entry<S, D, O> | null = goal
    while (cursor) {
      states.push(cursor.state)
      if (cursor.hop) hops.push(cursor.hop)
      cursor = cursor.parent
    }
    states.reverse()
    hops.reverse()
    const owners = new Set([...pathOwners(goal)].map((id): O => ownerValues[id]!))
    return { result: { found: true, states, hops, owners, distance: goal.distance, expandedLabelCount: work.oracleExpandedStates }, work, ownerMinimumProven: true, distanceMinimumProven: true }
  }

  if (options.isGoal(options.start)) return finish({ state: options.start, distance: 0, order: 0, parent: null, hop: null }, false)
  const condensed = buildOwnerCutCondensation({ start: options.start, getStateKey: options.getStateKey, isGoal: options.isGoal, getHops, getOwners, charge })
  if (!condensed) return finish(null, false)
  work.componentCount = condensed.adjacency.length
  work.condensedArcCount = condensed.adjacency.reduce((sum, arcs): number => sum + arcs.length, 0)
  work.rawConditionalArcCount = condensed.rawConditionalArcCount
  if (condensed.goals.size === 0) return finish(null, true)
  const reachable = (released: ReadonlySet<number>): { connected: boolean; cut: number[][] } => {
    work.componentOracleCalls++
    const queue = [condensed.start]
    const seen = new Set(queue)
    const blocked: Array<{ to: number; owners: readonly number[] }> = []
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const from = queue[cursor]!
      if (condensed.goals.has(from)) return { connected: true, cut: [] }
      if (!charge("componentExpandedStates")) return { connected: false, cut: [] }
      for (const arc of condensed.adjacency[from]!) {
        if (!charge("componentHopVisits")) return { connected: false, cut: [] }
        let permitted = true
        for (const owner of arc.owners) {
          if (!charge("ownerMembershipChecks")) return { connected: false, cut: [] }
          if (!released.has(owner)) { permitted = false; break }
        }
        if (!permitted) { blocked.push(arc); continue }
        if (seen.has(arc.to)) continue
        seen.add(arc.to)
        queue.push(arc.to)
      }
    }
    const terms = new Map<string, number[]>()
    for (const arc of blocked) {
      if (!charge("cutBoundaryVisits")) return { connected: false, cut: [] }
      if (seen.has(arc.to)) continue
      for (const _owner of arc.owners) if (!charge("cutOwnerVisits")) return { connected: false, cut: [] }
      terms.set(arc.owners.join(","), [...arc.owners])
    }
    return { connected: false, cut: [...terms.values()] }
  }
  let incumbent: Entry<S, D, O> | null = null
  let incumbentOwners: Set<number> | null = null
  while (true) {
    const released = master(incumbentOwners?.size ?? Infinity)
    if (limited) return finish(null, false)
    if (!released) {
      if (!incumbent) throw new Error("Owner-cut positive master exhausted without an incumbent")
      return finish(incumbent, false)
    }
    const componentSearch = reachable(released)
    if (limited) return finish(null, false)
    if (componentSearch.connected) {
      const search = oracle(released)
      if (search.limited) return finish(null, false)
      if (!search.goal) throw new Error("Stable owner-cut graph changed after reachability")
      const owners = pathOwners(search.goal)
      if (!incumbent || !incumbentOwners || owners.size < incumbentOwners.size || (owners.size === incumbentOwners.size && search.goal.distance < incumbent.distance)) {
        incumbent = search.goal
        incumbentOwners = owners
      }
      if (owners.size === 0) return finish(incumbent, false)
      testedChoices.add(choiceKey(released))
      work.connectedOwnerChoices++
      continue
    }
    if (componentSearch.cut.length === 0) throw new Error("Owner-cut condensation lost a reachable conditional path")
    cuts.push(componentSearch.cut)
    const newSingletons = new Set<number>()
    for (const term of componentSearch.cut) {
      if (!charge("singletonTermVisits")) return finish(null, false)
      if (term.length === 0) throw new Error("A failed reachability cut contains a free crossing")
      if (term.length === 1) newSingletons.add(term[0]!)
    }
    if (singletonOwners === null) singletonOwners = newSingletons
    else for (const owner of singletonOwners) {
      if (!charge("singletonIntersectionVisits")) return finish(null, false)
      if (!newSingletons.has(owner)) singletonOwners.delete(owner)
    }
    work.learnedCuts++
    work.learnedTerms += componentSearch.cut.length
  }
}
