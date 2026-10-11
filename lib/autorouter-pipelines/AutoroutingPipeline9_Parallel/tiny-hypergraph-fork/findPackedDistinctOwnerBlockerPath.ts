// Derived from tiny-hypergraph commit 474f5222e799b54348da41d96a0da0694509fab8.
// Copyright (c) 2026 tscircuit. MIT license: see LICENSE in this directory.

import type { DistinctOwnerBlockerHop, DistinctOwnerBlockerSearchOptions, DistinctOwnerBlockerSearchResult } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"

type Options<TState, THopData> = DistinctOwnerBlockerSearchOptions<TState, number, number, THopData> & { ownerCount: number }
type Hop<TState, THopData> = DistinctOwnerBlockerHop<TState, number, THopData>

const checkDisconnected = <TState, THopData>(
  options: Options<TState, THopData>,
  limit: number,
): { found: false; reason: "no_path"; expandedLabelCount: number } | undefined => {
  const queue = [options.start]
  const seen = new Set([options.getStateKey(options.start)])
  let expanded = 0
  let totalHopDistance = 0
  for (let index = 0; index < queue.length; index++) {
    const state = queue[index]!
    if (options.isGoal(state)) return undefined
    if (expanded >= limit) return undefined
    expanded++
    for (const hop of options.getHops(state)) {
      totalHopDistance += hop.distance
      if (hop.distance < 0 || !Number.isFinite(totalHopDistance)) return undefined
      const key = options.getStateKey(hop.state)
      if (seen.has(key)) continue
      seen.add(key)
      queue.push(hop.state)
    }
  }
  return { found: false, reason: "no_path", expandedLabelCount: expanded }
}

/** Numeric storage for the same ordered distinct-owner search used by the local Tiny fork.
 * Hops and their owner arrays remain immutable throughout this synchronous search.
 * The parent/predecessor row preserves original objects for result reconstruction.
 */
export const findPackedDistinctOwnerBlockerPath = <TState, THopData = unknown>(
  options: Options<TState, THopData>,
): DistinctOwnerBlockerSearchResult<TState, number, THopData> => {
  const limit = options.maxExpandedLabels ?? Number.POSITIVE_INFINITY
  if (limit !== Number.POSITIVE_INFINITY && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error("maxExpandedLabels must be a non-negative integer")
  }
  if (options.checkReachability) {
    const disconnected = checkDisconnected(options, limit)
    if (disconnected) return disconnected
  }
  const wordCount = Math.ceil(options.ownerCount / 32)
  // Most accepted hops add no owner. Share immutable rows until the union changes.
  const ownerRows: Uint32Array[] = [new Uint32Array(wordCount)]
  const ownerCounts = [0]
  const states: TState[] = [options.start]
  const incomingHops: Array<Hop<TState, THopData> | null> = [null]
  let capacity = 1024
  let parents = new Uint32Array(capacity)
  let distances = new Float64Array(capacity)
  let ownerRowIds = new Uint32Array(capacity)
  let orders = new Float64Array(capacity)
  let active = new Uint8Array(capacity)
  let labelOwnerCounts = new Uint32Array(capacity)
  const noParent = 0xffff_ffff
  parents[0] = noParent
  active[0] = 1
  // Keep Map key equality, including synthetic negative hop IDs. Survivors are
  // compacted in encounter order instead of allocating an array on every hop.
  const labelsByState = new Map<number, number[]>([[options.getStateKey(options.start), [0]]])
  const heap = [0]
  const addedRows = new WeakMap<readonly number[], Uint32Array>()
  const emptyAddedRow = ownerRows[0]!
  const emptyOwners: readonly number[] = []
  let nextOrder = 1
  let expanded = 0

  const growLabels = (): void => {
    capacity *= 2
    const nextParents = new Uint32Array(capacity)
    const nextDistances = new Float64Array(capacity)
    const nextOwnerRows = new Uint32Array(capacity)
    const nextOrders = new Float64Array(capacity)
    const nextActive = new Uint8Array(capacity)
    const nextOwnerCounts = new Uint32Array(capacity)
    nextParents.set(parents)
    nextDistances.set(distances)
    nextOwnerRows.set(ownerRowIds)
    nextOrders.set(orders)
    nextActive.set(active)
    nextOwnerCounts.set(labelOwnerCounts)
    parents = nextParents
    distances = nextDistances
    ownerRowIds = nextOwnerRows
    orders = nextOrders
    active = nextActive
    labelOwnerCounts = nextOwnerCounts
  }
  const compare = (left: number, right: number): number => {
    const countDifference = labelOwnerCounts[left]! - labelOwnerCounts[right]!
    if (countDifference !== 0) return countDifference
    const distanceDifference = distances[left]! - distances[right]!
    if (distanceDifference !== 0) return distanceDifference
    return orders[left]! - orders[right]!
  }
  const push = (label: number): void => {
    let index = heap.length
    heap.push(label)
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (compare(heap[parent]!, label) <= 0) break
      heap[index] = heap[parent]!
      index = parent
    }
    heap[index] = label
  }
  const pop = (): number => {
    if (heap.length === 0) return -1
    const first = heap[0]!
    const last = heap.pop()!
    if (heap.length === 0) return first
    heap[0] = last
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let best = index
      if (left < heap.length && compare(heap[left]!, heap[best]!) < 0) best = left
      if (right < heap.length && compare(heap[right]!, heap[best]!) < 0) best = right
      if (best === index) break
      const swap = heap[index]!
      heap[index] = heap[best]!
      heap[best] = swap
      index = best
    }
    return first
  }
  const getAddedRow = (owners: readonly number[]): Uint32Array => {
    if (owners.length === 0) return emptyAddedRow
    let row = addedRows.get(owners)
    if (row) return row
    row = new Uint32Array(wordCount)
    for (const owner of owners) row[owner >>> 5] = row[owner >>> 5]! | (1 << (owner & 31))
    addedRows.set(owners, row)
    return row
  }
  const subsetOfUnion = (subsetId: number, existingId: number, addedOwners: readonly number[]): boolean => {
    if (subsetId === existingId) return true
    if (ownerCounts[subsetId]! > ownerCounts[existingId]! + addedOwners.length) return false
    const added = getAddedRow(addedOwners)
    const subset = ownerRows[subsetId]!
    const existing = ownerRows[existingId]!
    for (let word = 0; word < wordCount; word++) {
      if ((subset[word]! & ~(existing[word]! | added[word]!)) !== 0) return false
    }
    return true
  }
  const subsetOfRow = (subsetId: number, supersetId: number): boolean => {
    if (subsetId === supersetId) return true
    if (ownerCounts[subsetId]! > ownerCounts[supersetId]!) return false
    const subset = ownerRows[subsetId]!
    const superset = ownerRows[supersetId]!
    for (let word = 0; word < wordCount; word++) {
      if ((subset[word]! & ~superset[word]!) !== 0) return false
    }
    return true
  }

  while (true) {
    let current = pop()
    while (current !== -1 && !active[current]) current = pop()
    if (current === -1) return { found: false, reason: "no_path", expandedLabelCount: expanded }
    if (options.isGoal(states[current]!)) {
      const pathStates: TState[] = []
      const pathHops: Hop<TState, THopData>[] = []
      let cursor = current
      while (cursor !== noParent) {
        pathStates.push(states[cursor]!)
        const incoming = incomingHops[cursor]
        if (incoming !== null) pathHops.push(incoming!)
        cursor = parents[cursor]!
      }
      pathStates.reverse()
      pathHops.reverse()
      // Subset tests do not require insertion order; public owners still do.
      // Replaying the original winning hops produces the same first encounters.
      const owners = new Set<number>()
      for (const hop of pathHops) for (const owner of hop.owners ?? []) owners.add(owner)
      return { found: true, states: pathStates, hops: pathHops, owners, distance: distances[current]!, expandedLabelCount: expanded }
    }
    if (expanded >= limit) return { found: false, reason: "expansion_limit", expandedLabelCount: expanded }
    expanded++
    for (const hop of options.getHops(states[current]!)) {
      if (!Number.isFinite(hop.distance) || hop.distance < 0) {
        throw new Error("Distinct-owner blocker hops require finite distances >= 0")
      }
      const distance = distances[current]! + hop.distance
      if (!Number.isFinite(distance)) throw new Error("Distinct-owner blocker path distance overflowed")
      const key = options.getStateKey(hop.state)
      // Rejected proposals consume queue order in the native helper too.
      const order = nextOrder++
      let existing = labelsByState.get(key)
      const addedOwners = hop.owners ?? emptyOwners
      const currentRowId = ownerRowIds[current]!
      let dominated = false
      if (existing) {
        for (const label of existing) {
          if (distances[label]! <= distance && subsetOfUnion(ownerRowIds[label]!, currentRowId, addedOwners)) {
            dominated = true
            break
          }
        }
      }
      if (dominated) continue
      const oldRow = ownerRows[currentRowId]!
      let rowId = currentRowId
      let row: Uint32Array | undefined
      let count = ownerCounts[currentRowId]!
      for (const owner of hop.owners ?? []) {
        const word = owner >>> 5
        const mask = 1 << (owner & 31)
        if (((row ?? oldRow)[word]! & mask) !== 0) continue
        if (!row) row = oldRow.slice()
        row[word] = row[word]! | mask
        count++
      }
      if (row) {
        rowId = ownerRows.length
        ownerRows.push(row)
        ownerCounts.push(count)
      }
      const candidate = states.length
      if (candidate === capacity) growLabels()
      states.push(hop.state)
      incomingHops.push(hop)
      parents[candidate] = current
      distances[candidate] = distance
      ownerRowIds[candidate] = rowId
      orders[candidate] = order
      active[candidate] = 1
      labelOwnerCounts[candidate] = count
      if (!existing) {
        existing = []
        labelsByState.set(key, existing)
      }
      let write = 0
      for (let index = 0; index < existing.length; index++) {
        const label = existing[index]!
        if (distance <= distances[label]! && subsetOfRow(rowId, ownerRowIds[label]!)) active[label] = 0
        else existing[write++] = label
      }
      existing.length = write
      existing.push(candidate)
      push(candidate)
    }
  }
}
