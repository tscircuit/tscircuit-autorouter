import type {
  DistinctOwnerBlockerHop,
  DistinctOwnerBlockerSearchOptions,
  DistinctOwnerBlockerSearchResult,
} from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { OwnerPairCutDomain, type OwnerPairCutWork } from "./OwnerPairCutDomain"
import { findGlobalOwnerBoundedDistance, type GlobalOwnerDistanceWork } from "./findGlobalOwnerBoundedDistance"

export type LazyOwnerReleaseOptions<S, K, O, D = unknown> =
  Pick<DistinctOwnerBlockerSearchOptions<S, K, O, D>, "start" | "getStateKey" | "isGoal" | "getHops"> & {
    maxWorkUnits: number
    distancePolicy?: "chosen-set" | "global-minimum"
  }

export type LazyOwnerReleaseWork = OwnerPairCutWork & GlobalOwnerDistanceWork & {
  workUnits: number; allocatedStates: number; materializedStates: number
  materializedHopOccurrences: number; ownerIdVisits: number; ownerSortItems: number
  ownerMembershipChecks: number; keyCharacters: number; initialFreeStates: number
  initialFreeHopVisits: number; initialBlockedOccurrences: number; baselineGateInsertions: number
  baselineTargetFilterReads: number; baselineIndexEntries: number; baselineOwnerTerms: number
  baselineGateTargets: number; trialCalls: number; activatedGroups: number; gateOwnerIndexReads: number
  trialSeedTargetReads: number; trialExpandedStates: number; trialHopVisits: number
  trialBlockedOccurrences: number; cutGroupChecks: number; cutTargetReads: number
  cutOutsideBoundaryReads: number; learnedCuts: number; learnedTerms: number
  masterCalls: number; masterStates: number; masterTermChecks: number
  masterOwnerChecks: number; masterUnionVisits: number; singletonIntersectionChecks: number
  shortestExpandedStates: number; shortestHopVisits: number; shortestQueuePushes: number
  shortestQueuePops: number; pathOwnerVisits: number
  pairPeakRetainedBytes: number
}

export type LazyOwnerReleaseResult<S, O, D = unknown> = {
  result: DistinctOwnerBlockerSearchResult<S, O, D>
  work: LazyOwnerReleaseWork
  ownerMinimumProven: boolean
  chosenSetDistanceMinimumProven: boolean
  /** True only when explicit global-minimum refinement completed. */
  globalDistanceMinimumProven: boolean
  provisionalMinimumOwnerCount: number | null
}

type Node<S, O, D> = {
  id: number; state: S; hops?: DistinctOwnerBlockerHop<S, O, D>[]
}
type OwnerTerm = { ids: number[]; key: string }
type GateGroup = OwnerTerm & { targets: number[] }
type RawGroup = OwnerTerm & { targets: Set<number> }
type BlockedGate = { to: number; term: OwnerTerm }
type Entry<S, O, D> = {
  node: Node<S, O, D>; distance: number; order: number
  previous: Entry<S, O, D> | null; hop: DistinctOwnerBlockerHop<S, O, D> | null
}

/** A stable queue retains original native hop insertion order at equal distance. */
class LazyOwnerDistanceQueue<S, O, D> {
  private entries: Entry<S, O, D>[] = []

  private less(a: Entry<S, O, D>, b: Entry<S, O, D>): boolean {
    if (a.distance !== b.distance) return a.distance < b.distance
    // No geometric cost or identity is changed by the stable tie breaker.
    // Equal-distance duplicate hops retain their occurrence insertion order.
    // This is shortest path only WITHIN one chosen released-owner set.
    // It makes no global tie claim across different owner sets.
    return a.order < b.order
  }

  push(entry: Entry<S, O, D>): void {
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

  pop(): Entry<S, O, D> | undefined {
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
 * Exact distinct-owner cardinality, then shortest path within the FIRST connected
 * minimum-cardinality owner set by default. Explicit global-minimum mode refines
 * across ALL owner sets of proved cardinality with one distance-priority search.
 *
 * R0 is the initial directed zero-owner closure, built once. Only its conditional
 * boundary is reused: no SCC or all-owners graph is constructed. Every later
 * choice explores newly reachable states outside R0. Failed trials learn actual
 * directed cut terms OR_hop(AND_required_owner released(owner)), including ALL
 * baseline exits whose destination remains outside the current reached set.
 *
 * Inputs/native callbacks and owner identities must remain immutable during this
 * synchronous query. Every helper cache belongs to this call. An exhausted work
 * budget returns explicit unknown, never a native fallback or physical verdict.
 */
export function findLazyMinimumOwnerRelease<S, K, O, D = unknown>(
  options: LazyOwnerReleaseOptions<S, K, O, D>,
): LazyOwnerReleaseResult<S, O, D> {
  if (!Number.isSafeInteger(options.maxWorkUnits) || options.maxWorkUnits < 0) {
    throw new Error("Lazy owner-release maxWorkUnits must be a nonnegative safe integer")
  }
  const work: LazyOwnerReleaseWork = {
    workUnits: 0, allocatedStates: 0, materializedStates: 0, materializedHopOccurrences: 0,
    ownerIdVisits: 0, ownerSortItems: 0, ownerMembershipChecks: 0, keyCharacters: 0,
    initialFreeStates: 0, initialFreeHopVisits: 0, initialBlockedOccurrences: 0,
    baselineGateInsertions: 0, baselineTargetFilterReads: 0, baselineIndexEntries: 0,
    baselineOwnerTerms: 0, baselineGateTargets: 0, trialCalls: 0, activatedGroups: 0,
    gateOwnerIndexReads: 0, trialSeedTargetReads: 0, trialExpandedStates: 0,
    trialHopVisits: 0, trialBlockedOccurrences: 0, cutGroupChecks: 0, cutTargetReads: 0,
    cutOutsideBoundaryReads: 0, learnedCuts: 0, learnedTerms: 0, masterCalls: 0,
    masterStates: 0, masterTermChecks: 0, masterOwnerChecks: 0, masterUnionVisits: 0,
    singletonIntersectionChecks: 0, shortestExpandedStates: 0, shortestHopVisits: 0,
    shortestQueuePushes: 0, shortestQueuePops: 0, pathOwnerVisits: 0,
    pairDomainRebuilds: 0, pairAllocatedWords: 0, pairInitializedWords: 0,
    pairReplayedCuts: 0, pairCutTerms: 0, pairTermOwnerReads: 0, pairDomainWordReads: 0,
    pairActiveTests: 0, pairChoiceWordReads: 0, pairStorageLimitHits: 0,
    pairPeakRetainedBytes: 0,
    globalExpandedLabels: 0, globalHopVisits: 0, globalOwnerUnionVisits: 0,
    globalDominanceTests: 0, globalSubsetOwnerChecks: 0, globalAllocatedLabels: 0,
    globalQueuePushes: 0, globalQueuePops: 0, globalQueueComparisons: 0,
    globalLabelLimitHits: 0, globalPeakQueueSize: 0, globalPeakStateLabels: 0,
  }
  const nodes: Array<Node<S, O, D>> = [], nodeByKey = new Map<K, Node<S, O, D>>()
  const ownerIds = new Map<O, number>(), ownerValues: O[] = []
  const hopTerms = new WeakMap<object, OwnerTerm>(), internedTerms = new Map<string, OwnerTerm>()
  const freeTerm: OwnerTerm = { ids: [], key: "" }
  const base = new Set<number>(), rawGroups = new Map<string, RawGroup>()
  const groups: GateGroup[] = [], groupsByOwner = new Map<number, GateGroup[]>()
  const cuts: number[][][] = []
  let singletonOwners: Set<number> | null = null
  let minimumCardinalityBound = 0, limited = false, provisionalMinimumOwnerCount: number | null = null

  const charge = (field: keyof LazyOwnerReleaseWork, units = 1): boolean => {
    if (limited || units > options.maxWorkUnits - work.workUnits) {
      limited = true
      return false
    }
    work.workUnits += units
    work[field] += units
    return true
  }
  const nodeFor = (state: S): Node<S, O, D> | undefined => {
    const key = options.getStateKey(state), known = nodeByKey.get(key)
    if (known) return known
    if (!charge("allocatedStates")) return undefined
    const node: Node<S, O, D> = { id: nodes.length, state }
    nodes.push(node)
    nodeByKey.set(key, node)
    return node
  }
  const pairDomain = new OwnerPairCutDomain(charge)
  const hopsFor = (node: Node<S, O, D>): DistinctOwnerBlockerHop<S, O, D>[] | undefined => {
    if (node.hops) return node.hops
    if (!charge("materializedStates")) return undefined
    // Native metadata generation is paid at first request, never precomputed.
    // Count its full array separately from iteration work; callbacks may do more
    // than one unit of CPU per hop. No array clone is added to the native cache.
    const provided = options.getHops(node.state)
    const hops: DistinctOwnerBlockerHop<S, O, D>[] = Array.isArray(provided) ? provided : [...provided]
    node.hops = hops
    work.materializedHopOccurrences += hops.length
    return hops
  }
  const termFor = (hop: DistinctOwnerBlockerHop<S, O, D>): OwnerTerm | undefined => {
    // Most native hops have no owners; share the empty value instead of adding
    // millions of empty term objects/WeakMap entries to the native hop cache.
    if (!hop.owners || (Array.isArray(hop.owners) && hop.owners.length === 0)) return freeTerm
    const known = hopTerms.get(hop)
    if (known) return known
    const ids = new Set<number>()
    for (const owner of hop.owners ?? []) {
      if (!charge("ownerIdVisits")) return undefined
      let id = ownerIds.get(owner)
      if (id === undefined) {
        id = ownerValues.length
        ownerValues.push(owner); ownerIds.set(owner, id)
      }
      ids.add(id)
    }
    const ordered = [...ids]
    if (!charge("ownerSortItems", ordered.length)) return undefined
    ordered.sort((a, b): number => a - b)
    const key = ordered.join(",")
    if (!charge("keyCharacters", key.length)) return undefined
    const term = internedTerms.get(key) ?? { ids: ordered, key }
    internedTerms.set(key, term)
    hopTerms.set(hop, term)
    return term
  }
  const permits = (ids: readonly number[], released: ReadonlySet<number>, master = false): boolean => {
    for (const owner of ids) {
      if (!charge(master ? "masterOwnerChecks" : "ownerMembershipChecks")) return false
      if (!released.has(owner)) return false
    }
    // Exhaustion is distinct from an ordinary false membership test.
    // Every caller checks the shared limited flag before interpreting a cut.
    return !limited
  }
  const addBaseGate = (target: number, term: OwnerTerm): boolean => {
    if (!charge("baselineGateInsertions")) return false
    let group = rawGroups.get(term.key)
    if (!group) {
      group = { ...term, targets: new Set<number>() }
      rawGroups.set(term.key, group)
    }
    group.targets.add(target)
    return true
  }
  const unknown = (): LazyOwnerReleaseResult<S, O, D> => ({
    result: { found: false, reason: "expansion_limit", expandedLabelCount: work.initialFreeStates + work.trialExpandedStates + work.shortestExpandedStates + work.globalExpandedLabels },
    work, ownerMinimumProven: false, chosenSetDistanceMinimumProven: false,
    globalDistanceMinimumProven: false, provisionalMinimumOwnerCount,
  })
  const noPath = (): LazyOwnerReleaseResult<S, O, D> => ({
    result: { found: false, reason: "no_path", expandedLabelCount: work.initialFreeStates + work.trialExpandedStates },
    work, ownerMinimumProven: false, chosenSetDistanceMinimumProven: false,
    globalDistanceMinimumProven: false, provisionalMinimumOwnerCount: null,
  })
  const shortest = (released: ReadonlySet<number>): LazyOwnerReleaseResult<S, O, D> => {
    if (options.distancePolicy === "global-minimum") {
      const answer = findGlobalOwnerBoundedDistance({ start: options.start, minimumOwners: released.size,
        getStateKey: options.getStateKey, isGoal: options.isGoal, work, charge,
        getHops: (state: S): DistinctOwnerBlockerHop<S, O, D>[] | undefined => {
          const node = nodeFor(state)
          if (!node) return undefined
          return hopsFor(node)
        },
        getOwnerIds: (hop: DistinctOwnerBlockerHop<S, O, D>): readonly number[] | undefined => termFor(hop)?.ids })
      if (!answer.found || limited) return unknown()
      const owners = new Set<O>()
      for (const hop of answer.hops) for (const owner of hop.owners ?? []) {
        if (!charge("pathOwnerVisits")) return unknown()
        owners.add(owner)
      }
      if (owners.size !== released.size) throw new Error("Global shortest witness contradicts proved owner cardinality")
      return { result: { found: true, states: answer.states, hops: answer.hops, owners, distance: answer.distance,
        expandedLabelCount: work.initialFreeStates + work.trialExpandedStates + work.globalExpandedLabels },
        work, ownerMinimumProven: true, chosenSetDistanceMinimumProven: true,
        globalDistanceMinimumProven: true, provisionalMinimumOwnerCount }
    }
    const first = nodeFor(options.start)
    if (!first) return unknown()
    const queue = new LazyOwnerDistanceQueue<S, O, D>(), best = new Map<number, number>([[first.id, 0]])
    const closed = new Set<number>()
    let order = 0
    if (!charge("shortestQueuePushes")) return unknown()
    queue.push({ node: first, distance: 0, order: order++, previous: null, hop: null })
    while (true) {
      if (!charge("shortestQueuePops")) return unknown()
      const entry = queue.pop()
      if (!entry) throw new Error("Immutable lazy owner graph lost its connected witness")
      if (entry.distance !== best.get(entry.node.id) || closed.has(entry.node.id)) continue
      if (options.isGoal(entry.node.state)) {
        const states: S[] = [], hops: DistinctOwnerBlockerHop<S, O, D>[] = [], owners = new Set<O>()
        let cursor: Entry<S, O, D> | null = entry
        while (cursor) {
          states.push(cursor.node.state)
          if (cursor.hop) {
            hops.push(cursor.hop)
          }
          cursor = cursor.previous
        }
        states.reverse(); hops.reverse()
        // The native caller consumes Set iteration order as rerip queue order.
        // Reconstruct first owner encounters in FORWARD path/hop order, just as
        // the native owner-label search does, rather than during parent unwind.
        for (const hop of hops) for (const owner of hop.owners ?? []) {
          if (!charge("pathOwnerVisits")) return unknown()
          owners.add(owner)
        }
        if (owners.size !== released.size) throw new Error("Lazy minimum-cardinality master certificate disagrees with witness owners")
        return { result: { found: true, states, hops, owners, distance: entry.distance,
          expandedLabelCount: work.initialFreeStates + work.trialExpandedStates + work.shortestExpandedStates },
          work, ownerMinimumProven: true, chosenSetDistanceMinimumProven: true,
          globalDistanceMinimumProven: false, provisionalMinimumOwnerCount }
      }
      if (!charge("shortestExpandedStates")) return unknown()
      closed.add(entry.node.id)
      const outgoing = hopsFor(entry.node)
      if (!outgoing) return unknown()
      for (const hop of outgoing) {
        if (!charge("shortestHopVisits")) return unknown()
        if (!Number.isFinite(hop.distance) || hop.distance < 0) throw new Error("Lazy owner hops require finite nonnegative distance")
        const term = termFor(hop)
        if (!term) return unknown()
        if (!permits(term.ids, released)) { if (limited) return unknown(); continue }
        const target = nodeFor(hop.state)
        if (!target) return unknown()
        const distance = entry.distance + hop.distance
        if (!Number.isFinite(distance)) throw new Error("Lazy owner path distance overflowed")
        if (distance >= (best.get(target.id) ?? Infinity)) continue
        if (!charge("shortestQueuePushes")) return unknown()
        best.set(target.id, distance)
        queue.push({ node: target, distance, order: order++, previous: entry, hop })
      }
    }
  }
  const learn = (cut: number[][]): boolean => {
    if (cut.length === 0) throw new Error("Empty cut must be handled as exact finite-query disconnection")
    cuts.push(cut); work.learnedCuts++; work.learnedTerms += cut.length
    const one = new Set<number>()
    for (const term of cut) {
      if (!charge("masterTermChecks")) return false
      if (term.length === 0) throw new Error("Failed lazy owner cut contains a free crossing")
      if (term.length === 1) one.add(term[0]!)
    }
    if (singletonOwners === null) singletonOwners = one
    else for (const id of singletonOwners) {
      if (!charge("singletonIntersectionChecks")) return false
      if (!one.has(id)) singletonOwners.delete(id)
    }
    minimumCardinalityBound = Math.max(minimumCardinalityBound, singletonOwners.size > 0 ? 1 : 2)
    return !limited
  }
  const master = (): Set<number> | undefined => {
    work.masterCalls++
    if (singletonOwners && singletonOwners.size > 0) return new Set([singletonOwners.values().next().value!])
    if (minimumCardinalityBound <= 2) {
      const pair = pairDomain.choose(ownerValues.length, cuts)
      work.pairPeakRetainedBytes = Math.max(work.pairPeakRetainedBytes, pairDomain.storage.bytes)
      if (pairDomain.storage.limited || limited) { limited = true; return undefined }
      if (pair) { minimumCardinalityBound = 2; return new Set(pair) }
      minimumCardinalityBound = 3
    }
    for (let cardinality = minimumCardinalityBound; cardinality <= ownerValues.length; cardinality++) {
      const pending = [new Set<number>()], seen = new Set<string>()
      while (pending.length > 0) {
        if (!charge("masterStates")) return undefined
        const selected = pending.pop()!, ordered = [...selected].sort((a, b): number => a - b), key = ordered.join(",")
        if (!charge("keyCharacters", key.length)) return undefined
        if (seen.has(key)) continue
        seen.add(key)
        let branch: number[][] | null = null
        for (const cut of cuts) {
          let satisfied = false
          const feasible: number[][] = []
          for (const term of cut) {
            if (!charge("masterTermChecks")) return undefined
            let additions = 0
            for (const owner of term) {
              if (!charge("masterOwnerChecks")) return undefined
              if (!selected.has(owner)) additions++
            }
            if (additions === 0) { satisfied = true; break }
            if (selected.size + additions <= cardinality) feasible.push(term)
          }
          if (!satisfied && (branch === null || feasible.length < branch.length)) branch = feasible
          if (branch?.length === 0) break
        }
        if (branch === null) { minimumCardinalityBound = cardinality; return selected }
        for (let index = branch.length - 1; index >= 0; index--) {
          const next = new Set(selected)
          for (const owner of branch[index]!) {
            if (!charge("masterUnionVisits")) return undefined
            next.add(owner)
          }
          pending.push(next)
        }
      }
    }
    if (!limited) throw new Error("Positive lazy owner master exhausted without satisfying its nonempty cuts")
    return undefined
  }

  const start = nodeFor(options.start)
  if (!start) return unknown()
  const freeQueue = [start]
  base.add(start.id)
  for (let cursor = 0; cursor < freeQueue.length; cursor++) {
    const node = freeQueue[cursor]!
    if (options.isGoal(node.state)) { provisionalMinimumOwnerCount = 0; return shortest(new Set()) }
    if (!charge("initialFreeStates")) return unknown()
    const outgoing = hopsFor(node)
    if (!outgoing) return unknown()
    for (const hop of outgoing) {
      if (!charge("initialFreeHopVisits")) return unknown()
      if (!Number.isFinite(hop.distance) || hop.distance < 0) throw new Error("Lazy owner hops require finite nonnegative distance")
      const term = termFor(hop), target = nodeFor(hop.state)
      if (!term || !target) return unknown()
      if (term.ids.length > 0) {
        if (!charge("initialBlockedOccurrences") || !addBaseGate(target.id, term)) return unknown()
      } else if (!base.has(target.id)) {
        base.add(target.id); freeQueue.push(target)
      }
    }
  }
  for (const raw of rawGroups.values()) {
    const targets: number[] = []
    for (const id of raw.targets) {
      if (!charge("baselineTargetFilterReads")) return unknown()
      if (!base.has(id)) targets.push(id)
    }
    if (targets.length === 0) continue
    const group: GateGroup = { ids: raw.ids, key: raw.key, targets }
    groups.push(group)
    const designated = group.ids[0]!
    let index = groupsByOwner.get(designated)
    if (!index) { index = []; groupsByOwner.set(designated, index) }
    if (!charge("baselineIndexEntries")) return unknown()
    index.push(group)
    work.baselineOwnerTerms++; work.baselineGateTargets += targets.length
  }
  rawGroups.clear()
  freeQueue.length = 0
  if (groups.length === 0) return noPath()
  if (!learn(groups.map((group) => group.ids))) return unknown()
  while (true) {
    const released = master()
    if (!released || limited) return unknown()
    work.trialCalls++
    const reached = new Set<number>(), queue: Array<Node<S, O, D>> = [], blocked: BlockedGate[] = []
    for (const owner of released) {
      if (!charge("gateOwnerIndexReads")) return unknown()
      const indexed = groupsByOwner.get(owner)
      if (!indexed) continue
      for (const group of indexed) {
        if (!permits(group.ids, released)) { if (limited) return unknown(); continue }
        work.activatedGroups++
        for (const target of group.targets) {
          if (!charge("trialSeedTargetReads")) return unknown()
          if (reached.has(target)) continue
          reached.add(target); queue.push(nodes[target]!)
        }
      }
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const node = queue[cursor]!
      if (options.isGoal(node.state)) { provisionalMinimumOwnerCount = released.size; return shortest(released) }
      if (!charge("trialExpandedStates")) return unknown()
      const outgoing = hopsFor(node)
      if (!outgoing) return unknown()
      for (const hop of outgoing) {
        if (!charge("trialHopVisits")) return unknown()
        if (!Number.isFinite(hop.distance) || hop.distance < 0) throw new Error("Lazy owner hops require finite nonnegative distance")
        const term = termFor(hop), target = nodeFor(hop.state)
        if (!term || !target) return unknown()
        if (base.has(target.id) || reached.has(target.id)) continue
        if (!permits(term.ids, released)) {
          if (limited || !charge("trialBlockedOccurrences")) return unknown()
          blocked.push({ to: target.id, term }); continue
        }
        reached.add(target.id); queue.push(target)
      }
    }
    const terms = new Map<string, number[]>()
    for (const group of groups) {
      if (!charge("cutGroupChecks")) return unknown()
      // A permitted baseline group was seeded in full before outside traversal.
      if (permits(group.ids, released)) continue
      if (limited) return unknown()
      for (const target of group.targets) {
        if (!charge("cutTargetReads")) return unknown()
        if (!reached.has(target)) { terms.set(group.key, group.ids); break }
      }
    }
    for (const gate of blocked) {
      if (!charge("cutOutsideBoundaryReads")) return unknown()
      if (!reached.has(gate.to)) terms.set(gate.term.key, gate.term.ids)
    }
    if (terms.size === 0) return noPath()
    if (!learn([...terms.values()])) return unknown()
  }
}
