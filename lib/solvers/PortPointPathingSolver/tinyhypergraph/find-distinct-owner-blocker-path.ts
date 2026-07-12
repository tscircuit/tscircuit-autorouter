export type DistinctOwnerBlockerHop<TState, TOwner, THopData = unknown> = {
  state: TState
  distance: number
  owners?: readonly TOwner[]
  data?: THopData
}

export type DistinctOwnerBlockerSearchOptions<
  TState,
  TStateKey,
  TOwner,
  THopData = unknown,
> = {
  start: TState
  getStateKey: (state: TState) => TStateKey
  isGoal: (state: TState) => boolean
  getHops: (
    state: TState,
  ) => Iterable<DistinctOwnerBlockerHop<TState, TOwner, THopData>>
  maxExpandedLabels?: number
}

export type DistinctOwnerBlockerSearchSuccess<
  TState,
  TOwner,
  THopData = unknown,
> = {
  found: true
  states: TState[]
  hops: Array<DistinctOwnerBlockerHop<TState, TOwner, THopData>>
  owners: ReadonlySet<TOwner>
  distance: number
  expandedLabelCount: number
}

export type DistinctOwnerBlockerSearchFailure = {
  found: false
  reason: "no_path" | "expansion_limit"
  expandedLabelCount: number
}

export type DistinctOwnerBlockerSearchResult<
  TState,
  TOwner,
  THopData = unknown,
> =
  | DistinctOwnerBlockerSearchSuccess<TState, TOwner, THopData>
  | DistinctOwnerBlockerSearchFailure

type SearchLabel<TState, TStateKey, TOwner, THopData> = {
  state: TState
  stateKey: TStateKey
  owners: Set<TOwner>
  distance: number
  parent: SearchLabel<TState, TStateKey, TOwner, THopData> | null
  incomingHop: DistinctOwnerBlockerHop<TState, TOwner, THopData> | null
  queueOrder: number
  active: boolean
}

const compareLabels = <TState, TStateKey, TOwner, THopData>(
  left: SearchLabel<TState, TStateKey, TOwner, THopData>,
  right: SearchLabel<TState, TStateKey, TOwner, THopData>,
): number => {
  const ownerCountDifference = left.owners.size - right.owners.size
  if (ownerCountDifference !== 0) return ownerCountDifference

  const distanceDifference = left.distance - right.distance
  if (distanceDifference !== 0) return distanceDifference

  return left.queueOrder - right.queueOrder
}

class SearchLabelQueue<TState, TStateKey, TOwner, THopData> {
  private readonly heap: Array<
    SearchLabel<TState, TStateKey, TOwner, THopData>
  > = []

  push(label: SearchLabel<TState, TStateKey, TOwner, THopData>): void {
    this.heap.push(label)
    let index = this.heap.length - 1

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (compareLabels(this.heap[parentIndex]!, this.heap[index]!) <= 0) {
        break
      }
      ;[this.heap[parentIndex], this.heap[index]] = [
        this.heap[index]!,
        this.heap[parentIndex]!,
      ]
      index = parentIndex
    }
  }

  pop(): SearchLabel<TState, TStateKey, TOwner, THopData> | null {
    const first = this.heap[0]
    const last = this.heap.pop()
    if (!first || !last) return null
    if (this.heap.length === 0) return first

    this.heap[0] = last
    let index = 0
    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      let bestIndex = index
      if (
        leftIndex < this.heap.length &&
        compareLabels(this.heap[leftIndex]!, this.heap[bestIndex]!) < 0
      ) {
        bestIndex = leftIndex
      }
      if (
        rightIndex < this.heap.length &&
        compareLabels(this.heap[rightIndex]!, this.heap[bestIndex]!) < 0
      ) {
        bestIndex = rightIndex
      }
      if (bestIndex === index) break
      ;[this.heap[index], this.heap[bestIndex]] = [
        this.heap[bestIndex]!,
        this.heap[index]!,
      ]
      index = bestIndex
    }

    return first
  }
}

const isOwnerSubset = <TOwner>(
  possibleSubset: ReadonlySet<TOwner>,
  possibleSuperset: ReadonlySet<TOwner>,
): boolean => {
  if (possibleSubset.size > possibleSuperset.size) return false
  for (const owner of possibleSubset) {
    if (!possibleSuperset.has(owner)) return false
  }

  return true
}

const labelDominates = <TState, TStateKey, TOwner, THopData>(
  left: SearchLabel<TState, TStateKey, TOwner, THopData>,
  right: SearchLabel<TState, TStateKey, TOwner, THopData>,
): boolean => {
  if (left.distance > right.distance) return false
  return isOwnerSubset(left.owners, right.owners)
}

const reconstructSuccessfulSearch = <TState, TStateKey, TOwner, THopData>(
  goal: SearchLabel<TState, TStateKey, TOwner, THopData>,
  expandedLabelCount: number,
): DistinctOwnerBlockerSearchSuccess<TState, TOwner, THopData> => {
  const states: TState[] = []
  const hops: Array<DistinctOwnerBlockerHop<TState, TOwner, THopData>> = []
  let cursor: SearchLabel<TState, TStateKey, TOwner, THopData> | null = goal
  while (cursor !== null) {
    states.push(cursor.state)
    if (cursor.incomingHop !== null) hops.push(cursor.incomingHop)
    cursor = cursor.parent
  }

  states.reverse()
  hops.reverse()
  return {
    found: true,
    states,
    hops,
    owners: new Set(goal.owners),
    distance: goal.distance,
    expandedLabelCount,
  }
}

const getNextActiveLabel = <TState, TStateKey, TOwner, THopData>(
  queue: SearchLabelQueue<TState, TStateKey, TOwner, THopData>,
): SearchLabel<TState, TStateKey, TOwner, THopData> | null => {
  while (true) {
    const label = queue.pop()
    if (label === null) return null
    if (label.active) return label
  }
}

export const findDistinctOwnerBlockerPath = <
  TState,
  TStateKey,
  TOwner,
  THopData = unknown,
>(
  options: DistinctOwnerBlockerSearchOptions<
    TState,
    TStateKey,
    TOwner,
    THopData
  >,
): DistinctOwnerBlockerSearchResult<TState, TOwner, THopData> => {
  const maxExpandedLabels =
    options.maxExpandedLabels ?? Number.POSITIVE_INFINITY
  if (
    maxExpandedLabels !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxExpandedLabels) || maxExpandedLabels < 0)
  ) {
    throw new Error("maxExpandedLabels must be a non-negative integer")
  }

  const labelsByStateKey = new Map<
    TStateKey,
    Array<SearchLabel<TState, TStateKey, TOwner, THopData>>
  >()
  const queue = new SearchLabelQueue<TState, TStateKey, TOwner, THopData>()
  let nextQueueOrder = 0
  let expandedLabelCount = 0
  const startLabel: SearchLabel<TState, TStateKey, TOwner, THopData> = {
    state: options.start,
    stateKey: options.getStateKey(options.start),
    owners: new Set<TOwner>(),
    distance: 0,
    parent: null,
    incomingHop: null,
    queueOrder: nextQueueOrder++,
    active: true,
  }
  labelsByStateKey.set(startLabel.stateKey, [startLabel])
  queue.push(startLabel)

  while (true) {
    const current = getNextActiveLabel(queue)
    if (current === null) {
      return { found: false, reason: "no_path", expandedLabelCount }
    }
    if (options.isGoal(current.state)) {
      return reconstructSuccessfulSearch(current, expandedLabelCount)
    }
    if (expandedLabelCount >= maxExpandedLabels) {
      return { found: false, reason: "expansion_limit", expandedLabelCount }
    }
    expandedLabelCount++

    for (const hop of options.getHops(current.state)) {
      if (!Number.isFinite(hop.distance) || hop.distance < 0) {
        throw new Error(
          "Distinct-owner blocker hops require finite distances >= 0",
        )
      }

      const owners = new Set(current.owners)
      for (const owner of hop.owners ?? []) owners.add(owner)
      const distance = current.distance + hop.distance
      if (!Number.isFinite(distance)) {
        throw new Error("Distinct-owner blocker path distance overflowed")
      }
      const candidate: SearchLabel<TState, TStateKey, TOwner, THopData> = {
        state: hop.state,
        stateKey: options.getStateKey(hop.state),
        owners,
        distance,
        parent: current,
        incomingHop: hop,
        queueOrder: nextQueueOrder++,
        active: true,
      }
      const existingLabels = labelsByStateKey.get(candidate.stateKey) ?? []
      if (existingLabels.some((label) => labelDominates(label, candidate))) {
        continue
      }

      const survivingLabels: Array<
        SearchLabel<TState, TStateKey, TOwner, THopData>
      > = []
      for (const label of existingLabels) {
        if (labelDominates(candidate, label)) {
          label.active = false
        } else {
          survivingLabels.push(label)
        }
      }
      survivingLabels.push(candidate)
      labelsByStateKey.set(candidate.stateKey, survivingLabels)
      queue.push(candidate)
    }
  }
}
