import type { DistinctOwnerBlockerHop, DistinctOwnerBlockerSearchResult } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { MinHeap } from "tiny-hypergraph/lib/MinHeap"

export type FeasibleOwnerWork = {
  workUnits: number; setupWork: number; nativeFactoryWorkBound: number
  generatedStates: number; generatedHops: number; validatedHops: number
  generatorCalls: number; generatorExpandedStates: number; generatorHopVisits: number
  refinementCalls: number; refinementExpandedStates: number; refinementHopVisits: number
  ownerChecks: number; ownerCopies: number; ownerPriceReads: number
  queueComparisons: number; queuePushes: number; queuePops: number
  allocatedLabels: number; peakQueueSize: number; storageLimitHits: number
  generatedCandidates: number
  witnessHopChecks: number; witnessOwnerChecks: number
}
class FeasibleHeapBudgetStop extends Error {}

type Charge = (field: Exclude<keyof FeasibleOwnerWork, "workUnits" | "peakQueueSize">, units?: number) => boolean
export type FeasibleOwnerCorridorOptions<S, K, O, D> = {
  start: S; getStateKey(state: S): K; isGoal(state: S): boolean
  /** Native immutable hops. Charge their conservative construction bound BEFORE creation. */
  getHops(state: S, charge: Charge): readonly DistinctOwnerBlockerHop<S, O, D>[] | undefined
  getOwnerWork(owner: O): number
  getGoalDistance(state: S): number
  distanceScale: number; maxExpandedLabels: number; initialWorkUnits?: number
  maxWorkUnits?: number; maximumStoredLabels?: number
}
export type FeasibleOwnerCorridorAnswer<S, O, D> = {
  result: DistinctOwnerBlockerSearchResult<S, O, D>
  work: FeasibleOwnerWork
  objectiveMinimumProven: false
  chosenSetDistanceMinimumProven: boolean
  selectedOwnerWork?: number; selectedScore?: number
  candidateOwnerCounts: number[]
}
type Label<S, O, D> = {
  state: S; owners: ReadonlySet<O>; ownerWork: number; distance: number
  score: number; priority: number; order: number
  parent: Label<S, O, D> | null; hop: DistinctOwnerBlockerHop<S, O, D> | null
}
type Corridor<S, O, D> = {
  states: S[]; hops: DistinctOwnerBlockerHop<S, O, D>[]
  owners: Set<O>; ownerWork: number; distance: number; score: number
}

export const FEASIBLE_OWNER_WORK_LIMIT = 300000000
export const FEASIBLE_OWNER_LABEL_LIMIT = 1000000

/**
 * Explicit changed policy: one demand-driven feasible corridor generator keeps
 * one scalar label per directed state, charging each owner ONCE. Its score is
 * owner reroute work +4*distance/max(1,start-goal distance). A fixed-owner
 * Dijkstra then proves shortest distance only within that selected owner set.
 * No minimum-owner or globally minimum weighted-work objective is claimed.
 *
 * Keeping one owner history per state can lose good alternatives, but cannot
 * invent feasibility: each returned original hop retains ALL required owners.
 * Histories are immutable, including those whose queued labels are superseded.
 * The generator/refinement share native expansion and fixed work/storage caps.
 * Any incomplete stage returns UNKNOWN, never an old-search answer or no_path.
 */
export function findFeasibleOwnerCorridor<S, K, O, D>(
  options: FeasibleOwnerCorridorOptions<S, K, O, D>,
): FeasibleOwnerCorridorAnswer<S, O, D> {
  const work: FeasibleOwnerWork = {
    workUnits: 0, setupWork: 0, nativeFactoryWorkBound: 0,
    generatedStates: 0, generatedHops: 0, validatedHops: 0,
    generatorCalls: 0, generatorExpandedStates: 0, generatorHopVisits: 0,
    refinementCalls: 0, refinementExpandedStates: 0, refinementHopVisits: 0,
    ownerChecks: 0, ownerCopies: 0, ownerPriceReads: 0,
    queueComparisons: 0, queuePushes: 0, queuePops: 0,
    allocatedLabels: 0, peakQueueSize: 0, storageLimitHits: 0,
    generatedCandidates: 0,
    witnessHopChecks: 0, witnessOwnerChecks: 0,
  }
  const workLimit = options.maxWorkUnits ?? FEASIBLE_OWNER_WORK_LIMIT
  const labelLimit = options.maximumStoredLabels ?? FEASIBLE_OWNER_LABEL_LIMIT
  for (const [value, maximum] of [[workLimit, FEASIBLE_OWNER_WORK_LIMIT], [labelLimit, FEASIBLE_OWNER_LABEL_LIMIT]]) {
    if (!Number.isSafeInteger(value) || value! < 0 || value! > maximum!) throw new Error("Feasible owner cap must not exceed its fixed policy")
  }
  if (!Number.isSafeInteger(options.maxExpandedLabels) || options.maxExpandedLabels < 0 ||
    !Number.isFinite(options.distanceScale) || options.distanceScale <= 0) throw new Error("Feasible owner query requires finite native expansion/metric policy")
  let limited = false, expanded = 0, order = 0
  const charge: Charge = (field, units = 1): boolean => {
    if (!Number.isSafeInteger(units) || units < 0) throw new Error("Feasible owner work must be finite nonnegative integer")
    if (limited || units > workLimit - work.workUnits) { limited = true; return false }
    work[field] += units
    work.workUnits += units
    return true
  }
  const initial = options.initialWorkUnits ?? 0
  charge("setupWork", initial)
  const cachedHops = new Map<K, readonly DistinctOwnerBlockerHop<S, O, D>[]>()
  const ownerPrices = new Map<O, number>()
  const price = (owner: O): number => {
    if (!charge("ownerPriceReads")) return 0
    const previous = ownerPrices.get(owner)
    if (previous !== undefined) return previous
    const value = options.getOwnerWork(owner)
    if (!Number.isFinite(value) || value < 0) throw new Error("Owner reroute-work estimate must be finite nonnegative")
    ownerPrices.set(owner, value)
    return value
  }
  const hopsFor = (state: S): readonly DistinctOwnerBlockerHop<S, O, D>[] | undefined => {
    const key = options.getStateKey(state), cached = cachedHops.get(key)
    if (cached) return cached
    if (!charge("generatedStates")) return undefined
    const hops = options.getHops(state, charge)
    if (limited) return undefined
    if (hops === undefined) throw new Error("Native corridor generator returned no hops without a charged budget stop")
    for (const hop of hops) {
      if (!charge("validatedHops")) return undefined
      if (!Number.isFinite(hop.distance) || hop.distance < 0) throw new Error("Native corridor hop needs finite nonnegative distance")
    }
    work.generatedHops += hops.length
    cachedHops.set(key, hops)
    return hops
  }
  const witness = (last: Label<S, O, D>): Corridor<S, O, D> | undefined => {
    const states: S[] = [], hops: DistinctOwnerBlockerHop<S, O, D>[] = []
    for (let cursor: Label<S, O, D> | null = last; cursor; cursor = cursor.parent) {
      if (!charge("witnessHopChecks")) return undefined
      states.push(cursor.state)
      if (cursor.hop) hops.push(cursor.hop)
    }
    states.reverse(); hops.reverse()
    const owners = new Set<O>()
    let ownerWork = 0
    for (const hop of hops) for (const owner of hop.owners ?? []) {
      if (!charge("witnessOwnerChecks")) return undefined
      if (owners.has(owner)) continue
      owners.add(owner)
      ownerWork += price(owner)
    }
    if (limited) return undefined
    return { states, hops, owners, ownerWork, distance: last.distance,
      score: ownerWork + 4 * last.distance / options.distanceScale }
  }
  const search = (allowedOwners?: ReadonlySet<O>): Corridor<S, O, D> | undefined => {
    const refinement = allowedOwners !== undefined
    const distanceWeight = refinement ? 1 : 4
    if (!charge(refinement ? "refinementCalls" : "generatorCalls")) return undefined
    const best = new Map<K, Label<S, O, D>>(), closed = new Set<K>()
    const queue = new MinHeap<Label<S, O, D>>([], (a, b): number => {
      if (!charge("queueComparisons")) throw new FeasibleHeapBudgetStop("Feasible heap work cap")
      const priority = a.priority - b.priority
      if (priority !== 0) return priority
      const score = a.score - b.score
      return score !== 0 ? score : a.order - b.order
    })
    const enqueue = (label: Label<S, O, D>): boolean => {
      if (work.allocatedLabels >= labelLimit) { work.storageLimitHits++; limited = true; return false }
      if (!charge("allocatedLabels") || !charge("queuePushes")) return false
      best.set(options.getStateKey(label.state), label)
      try { queue.queue(label) }
      catch (error) {
        if (!(error instanceof FeasibleHeapBudgetStop)) throw error
        return false
      }
      work.peakQueueSize = Math.max(work.peakQueueSize, queue.length)
      return !limited
    }
    const start: Label<S, O, D> = { state: options.start, owners: new Set<O>(), ownerWork: 0,
      distance: 0, score: 0, priority: 0, order: order++, parent: null, hop: null }
    if (!enqueue(start)) return undefined
    while (queue.length > 0) {
      if (!charge("queuePops")) return undefined
      let current: Label<S, O, D>
      try { current = queue.dequeue()! }
      catch (error) {
        if (!(error instanceof FeasibleHeapBudgetStop)) throw error
        return undefined
      }
      if (limited) return undefined
      const key = options.getStateKey(current.state)
      if (closed.has(key) || best.get(key) !== current) continue
      if (options.isGoal(current.state)) return witness(current)
      if (expanded >= options.maxExpandedLabels) { limited = true; return undefined }
      expanded++
      if (!charge(refinement ? "refinementExpandedStates" : "generatorExpandedStates")) return undefined
      closed.add(key)
      const hops = hopsFor(current.state)
      if (!hops) return undefined
      for (const hop of hops) {
        if (!charge(refinement ? "refinementHopVisits" : "generatorHopVisits")) return undefined
        const nextKey = options.getStateKey(hop.state)
        if (closed.has(nextKey)) continue
        let owners = current.owners, ownerWork = current.ownerWork
        let copy: Set<O> | undefined, allowed = true
        for (const owner of hop.owners ?? []) {
          if (!charge("ownerChecks")) return undefined
          if (refinement) { if (!allowedOwners!.has(owner)) { allowed = false; break } }
          else if (!owners.has(owner)) {
            if (!copy) {
              if (!charge("ownerCopies", owners.size)) return undefined
              copy = new Set(owners); owners = copy
            }
            copy.add(owner)
            ownerWork += price(owner)
          }
        }
        if (limited) return undefined
        if (!allowed) continue
        const distance = current.distance + hop.distance
        const score = refinement ? distance : ownerWork + distanceWeight * distance / options.distanceScale
        if (!Number.isFinite(score) || !Number.isFinite(distance)) throw new Error("Feasible corridor score overflowed")
        if ((best.get(nextKey)?.score ?? Infinity) <= score) continue
        const estimate = refinement ? 0 : options.getGoalDistance(hop.state)
        if (!Number.isFinite(estimate) || estimate < 0) throw new Error("Feasible corridor goal estimate must be finite nonnegative")
        const priority = score + distanceWeight * estimate / options.distanceScale
        if (!Number.isFinite(priority)) throw new Error("Feasible corridor priority overflowed")
        if (!enqueue({ state: hop.state, owners, ownerWork, distance, score, priority,
          order: order++, parent: current, hop })) return undefined
      }
    }
    return undefined
  }
  const unknown = (): FeasibleOwnerCorridorAnswer<S, O, D> => ({
    result: {
      found: false,
      reason: "expansion_limit",
      expandedLabelCount: expanded,
    },
    work,
    objectiveMinimumProven: false,
    chosenSetDistanceMinimumProven: false,
    candidateOwnerCounts: [],
  })
  if (limited) return unknown()
  const selected = search()
  if (limited) return unknown()
  if (!selected) {
    return { result: { found: false, reason: "no_path", expandedLabelCount: expanded }, work,
      objectiveMinimumProven: false, chosenSetDistanceMinimumProven: false, candidateOwnerCounts: [] }
  }
  work.generatedCandidates++
  const refined = search(selected.owners)
  if (limited) return unknown()
  if (!refined) throw new Error("Native fixed-owner refinement lost its generated witness")
  return { result: { found: true, states: refined.states, hops: refined.hops,
    owners: refined.owners, distance: refined.distance, expandedLabelCount: expanded }, work,
    objectiveMinimumProven: false, chosenSetDistanceMinimumProven: true,
    selectedOwnerWork: refined.ownerWork, selectedScore: refined.score,
    candidateOwnerCounts: [selected.owners.size] }
}
