export type OwnerCutHop = {
  target: number
  owners: readonly number[]
  distance: number
}

export type OwnerCutWork = {
  units: number
  expandedStates: number
  generatedHops: number
  masterAssignments: number
  learnedCuts: number
  peakStoredHops: number
}

export type OwnerCutPathOptions = {
  start: number
  goal: number
  stateCount: number
  getHops: (
    state: number,
    charge: (units: number) => boolean,
  ) => readonly OwnerCutHop[] | undefined
  /** Caller supplies a nonnegative consistent lower bound; zero is Dijkstra. */
  getConsistentLowerBound?: (state: number) => number
  getOwnerPrice: (owner: number) => number
  maxWorkUnits: number
  maxOwners?: number
  maxCuts?: number
  maxStoredHops?: number
}

export type OwnerCutPathResult = {
  status: "found" | "no_path" | "unknown"
  states: number[]
  hops: OwnerCutHop[]
  owners: number[]
  ownerFee: number
  distance: number
  work: OwnerCutWork
}

type StoredHop = OwnerCutHop & { mask: number }
type QueueEntry = { state: number; distance: number; priority: number; order: number }

/**
 * Minimum activation fee on a frozen finite owner-labelled graph. A complete
 * disconnected oracle learns OR(boundary edge's AND(required owners)). A
 * bounded oracle never learns a cut. After choosing a minimum-fee owner set,
 * Dijkstra finds its shortest additive path. Ties between equally priced sets
 * use owner discovery order, not the globally best combined native A* score.
 */
export function findOwnerCutPath(
  options: OwnerCutPathOptions,
): OwnerCutPathResult {
  const maxOwners = options.maxOwners ?? 8
  const maxCuts = options.maxCuts ?? 32
  const maxStoredHops = options.maxStoredHops ?? 20_480
  if (
    !Number.isSafeInteger(options.stateCount) || options.stateCount < 1 ||
    options.stateCount > 2048 || !Number.isSafeInteger(options.start) ||
    !Number.isSafeInteger(options.goal) || options.start < 0 ||
    options.start >= options.stateCount || options.goal < 0 ||
    options.goal >= options.stateCount || !Number.isSafeInteger(maxOwners) ||
    maxOwners < 0 || maxOwners > 8 || !Number.isSafeInteger(maxCuts) ||
    maxCuts < 0 || maxCuts > 32 || !Number.isSafeInteger(maxStoredHops) ||
    maxStoredHops < 0 || maxStoredHops > 20_480 ||
    !Number.isSafeInteger(options.maxWorkUnits) || options.maxWorkUnits < 0
  ) throw new Error("Invalid owner-cut finite graph or work limits")
  const work: OwnerCutWork = {
    units: 0, expandedStates: 0, generatedHops: 0,
    masterAssignments: 0, learnedCuts: 0, peakStoredHops: 0,
  }
  let limited = false
  const charge = (units: number): boolean => {
    if (!Number.isSafeInteger(units) || units < 0)
      throw new Error("Owner-cut work must be a nonnegative integer")
    if (limited || units > options.maxWorkUnits - work.units) {
      limited = true
      return false
    }
    work.units += units
    return true
  }
  const owners: number[] = []
  const ownerBits = new Map<number, number>()
  const prices: number[] = []
  const cached = new Map<number, StoredHop[]>()
  const cuts: number[][] = []
  const answer = (
    status: OwnerCutPathResult["status"],
  ): OwnerCutPathResult => ({
    status, states: [], hops: [], owners: [], ownerFee: 0, distance: 0, work,
  })
  const hopsFor = (state: number): StoredHop[] | undefined => {
    const previous = cached.get(state)
    if (previous) return previous
    const hops = options.getHops(state, charge)
    if (limited || !hops) return undefined
    if (work.generatedHops + hops.length > maxStoredHops) {
      limited = true
      return undefined
    }
    const stored: StoredHop[] = []
    for (const hop of hops) {
      if (!charge(1 + hop.owners.length)) return undefined
      if (!Number.isSafeInteger(hop.target) || hop.target < 0 ||
        hop.target >= options.stateCount || !Number.isFinite(hop.distance) ||
        hop.distance < 0) throw new Error("Invalid immutable owner-cut hop")
      let mask = 0
      for (const owner of hop.owners) {
        let bit = ownerBits.get(owner)
        if (bit === undefined) {
          if (owners.length === maxOwners) {
            limited = true
            return undefined
          }
          const price = options.getOwnerPrice(owner)
          if (!Number.isFinite(price) || price < 0)
            throw new Error("Owner-cut activation prices must be nonnegative")
          bit = 1 << owners.length
          ownerBits.set(owner, bit)
          owners.push(owner)
          prices.push(price)
        }
        mask |= bit
      }
      stored.push({ ...hop, owners: [...hop.owners], mask })
    }
    work.generatedHops += stored.length
    work.peakStoredHops = work.generatedHops
    cached.set(state, stored)
    return stored
  }
  let selected = 0
  while (true) {
    if (!charge(options.stateCount * 3)) return answer("unknown")
    const distance = new Float64Array(options.stateCount).fill(Infinity)
    const predecessor = new Int32Array(options.stateCount).fill(-1)
    const previousHop: Array<StoredHop | undefined> =
      new Array(options.stateCount)
    const closed = new Uint8Array(options.stateCount)
    const boundary: Array<{ target: number; mask: number }> = []
    const queue: QueueEntry[] = []
    let order = 0
    const less = (a: QueueEntry, b: QueueEntry): boolean =>
      a.priority < b.priority ||
      (a.priority === b.priority && a.order < b.order)
    const push = (entry: QueueEntry): boolean => {
      if (!charge(1)) return false
      const lowerBound = options.getConsistentLowerBound?.(entry.state) ?? 0
      if (!Number.isFinite(lowerBound) || lowerBound < 0)
        throw new Error("Invalid consistent owner-cut lower bound")
      entry.priority = entry.distance + lowerBound
      let index = queue.length
      queue.push(entry)
      while (index > 0) {
        if (!charge(1)) return false
        const parent = (index - 1) >> 1
        if (!less(entry, queue[parent]!)) break
        queue[index] = queue[parent]!
        index = parent
      }
      queue[index] = entry
      return true
    }
    const pop = (): QueueEntry | undefined => {
      if (!charge(1)) return undefined
      const first = queue[0]
      const last = queue.pop()
      if (!queue.length || !last) return first
      let index = 0
      while (index * 2 + 1 < queue.length) {
        if (!charge(2)) return undefined
        const left = index * 2 + 1
        const right = left + 1
        const child = right < queue.length && less(queue[right]!, queue[left]!)
          ? right : left
        if (!less(queue[child]!, last)) break
        queue[index] = queue[child]!
        index = child
      }
      queue[index] = last
      return first
    }
    distance[options.start] = 0
    push({ state: options.start, distance: 0, priority: 0, order: order++ })
    while (queue.length && !limited) {
      const current = pop()
      if (!current || limited) return answer("unknown")
      if (closed[current.state] || current.distance !== distance[current.state])
        continue
      closed[current.state] = 1
      if (current.state === options.goal) {
        const result = answer("found")
        let cursor = current.state
        const usedOwners = new Set<number>()
        while (cursor !== options.start) {
          if (!charge(1)) return answer("unknown")
          result.states.push(cursor)
          const hop = previousHop[cursor]
          if (!hop) throw new Error("Owner-cut witness lost its immutable hop")
          result.hops.push(hop)
          if (!charge(hop.owners.length)) return answer("unknown")
          for (const owner of hop.owners) usedOwners.add(owner)
          cursor = predecessor[cursor]!
        }
        result.states.push(options.start)
        result.states.reverse()
        result.hops.reverse()
        result.owners = [...usedOwners]
        if (!charge(64)) return answer("unknown")
        result.ownerFee = result.owners.reduce((sum, owner) =>
          sum + prices[owners.indexOf(owner)]!, 0)
        result.distance = current.distance
        return result
      }
      work.expandedStates++
      const hops = hopsFor(current.state)
      if (!hops) return answer("unknown")
      for (const hop of hops) {
        if (!charge(1)) return answer("unknown")
        if ((hop.mask & selected) !== hop.mask) {
          boundary.push({ target: hop.target, mask: hop.mask })
          continue
        }
        if (closed[hop.target]) continue
        const nextDistance = current.distance + hop.distance
        if (nextDistance >= distance[hop.target]!) continue
        distance[hop.target] = nextDistance
        predecessor[hop.target] = current.state
        previousHop[hop.target] = hop
        if (!push({ state: hop.target, distance: nextDistance, priority: 0, order: order++ }))
          return answer("unknown")
      }
    }
    if (limited) return answer("unknown")
    const alternatives = new Set<number>()
    for (const { target, mask } of boundary) {
      if (!charge(1)) return answer("unknown")
      if (!closed[target]) alternatives.add(mask)
    }
    if (!alternatives.size) return answer("no_path")
    if (cuts.length === maxCuts) return answer("unknown")
    cuts.push([...alternatives])
    work.learnedCuts++
    let bestMask = -1
    let bestPrice = Infinity
    for (let mask = 0; mask < 1 << owners.length; mask++) {
      if (!charge(1 + owners.length)) return answer("unknown")
      work.masterAssignments++
      let price = 0
      for (let bit = 0; bit < owners.length; bit++)
        if (mask & (1 << bit)) price += prices[bit]!
      if (price >= bestPrice) continue
      let satisfies = true
      for (const cut of cuts) {
        if (!charge(cut.length)) return answer("unknown")
        if (!cut.some((required) => (required & mask) === required)) {
          satisfies = false
          break
        }
      }
      if (satisfies) {
        bestMask = mask
        bestPrice = price
      }
    }
    if (bestMask < 0) throw new Error("Owner-cut master rejected all owners")
    selected = bestMask
  }
}
