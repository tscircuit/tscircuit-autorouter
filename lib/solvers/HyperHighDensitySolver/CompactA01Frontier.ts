export interface CompactA01RippedConnection {
  id: number
  prev: CompactA01RippedConnection | null
  compactMask?: number
}

export interface CompactA01Label {
  z: number
  row: number
  col: number
  g: number
  parentIdx: number
  ripped: CompactA01RippedConnection | null
}

export interface CompactA01FrontierMetrics {
  enqueued: number
  prunedEquivalent: number
  popped: number
  alreadyVisited: number
  expanded: number
  searches: number
  peakLabels: number
  peakOpen: number
  materializedPathLabels: number
}

/** Reusable label and stable heap arenas; sequence ties match the pinned A01. */
export class CompactA01Frontier {
  readonly metrics: CompactA01FrontierMetrics = {
    enqueued: 0,
    prunedEquivalent: 0,
    popped: 0,
    alreadyVisited: 0,
    expanded: 0,
    searches: 0,
    peakLabels: 0,
    peakOpen: 0,
    materializedPathLabels: 0,
  }
  cells = new Uint32Array(0)
  costs = new Float64Array(0)
  parents = new Int32Array(0)
  ripped: Array<CompactA01RippedConnection | null> = []
  labelCount = 0
  private priorities = new Float64Array(0)
  private sequences = new Float64Array(0)
  private labels = new Uint32Array(0)
  private openCount = 0
  private sequence = 0
  private readonly bestQueuedCost = new Map<number, number>()
  private readonly victimMaskLimit: number

  static isCapacitySupported(stateCount: number, connectionCount = 32): boolean {
    if (!Number.isSafeInteger(connectionCount) || connectionCount < 0 || connectionCount > 32) return false
    if (!Number.isSafeInteger(stateCount) || stateCount <= 0 || stateCount > 2 ** 32) return false
    // Every key is mask*S+cell, with max key 2^N*S-1. Multiplication by
    // 2^N is exact for integer S<=2^32, including the safe equality boundary.
    return 2 ** connectionCount * stateCount <= 2 ** 53
  }

  constructor(
    readonly stateCount: number,
    readonly pruneEquivalentLabels: boolean,
    readonly connectionCount = 32,
  ) {
    if (!CompactA01Frontier.isCapacitySupported(stateCount, connectionCount)) {
      throw new Error(`Compact A01 capacity requires N<=32, S<=2^32 and 2^N*S<=2^53; got N=${connectionCount}, S=${stateCount}`)
    }
    this.victimMaskLimit = 2 ** connectionCount
  }

  get size(): number {
    return this.openCount
  }

  clear(): void {
    this.openCount = 0
    this.labelCount = 0
    this.sequence = 0
    this.ripped.length = 0
    this.bestQueuedCost.clear()
  }

  enqueue(
    cell: number,
    g: number,
    f: number,
    parent: number,
    ripped: CompactA01RippedConnection | null,
  ): void {
    const sequence = this.sequence++
    if (this.pruneEquivalentLabels) {
      const mask = this.getVictimMask(ripped)
      // Unsigned bit31 is required. The checked owner-dependent bound makes
      // mask*S+cell injective and exactly representable through MAX_SAFE_INTEGER.
      const key = mask * this.stateCount + cell
      const bestCost = this.bestQueuedCost.get(key)
      if (bestCost !== undefined && bestCost <= g) {
        this.metrics.prunedEquivalent++
        return
      }
      this.bestQueuedCost.set(key, g)
    }
    if (this.labelCount === this.cells.length) this.growLabels()
    if (this.openCount === this.labels.length) this.growHeap()
    const label = this.labelCount++
    this.cells[label] = cell
    this.costs[label] = g
    this.parents[label] = parent
    this.ripped[label] = ripped
    let index = this.openCount++
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parentF = this.priorities[parentIndex]!
      const parentSequence = this.sequences[parentIndex]!
      if (parentF !== f ? parentF < f : parentSequence < sequence) break
      this.priorities[index] = parentF
      this.sequences[index] = parentSequence
      this.labels[index] = this.labels[parentIndex]!
      index = parentIndex
    }
    this.priorities[index] = f
    this.sequences[index] = sequence
    this.labels[index] = label
    this.metrics.enqueued++
    this.metrics.peakLabels = Math.max(this.metrics.peakLabels, this.labelCount)
    this.metrics.peakOpen = Math.max(this.metrics.peakOpen, this.openCount)
  }

  pop(): number {
    if (this.openCount === 0) throw new Error("Compact A01 popped an empty frontier")
    const output = this.labels[0]!
    this.openCount--
    if (this.openCount > 0) {
      const f = this.priorities[this.openCount]!
      const sequence = this.sequences[this.openCount]!
      const label = this.labels[this.openCount]!
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        if (left >= this.openCount) break
        let child = left
        if (right < this.openCount) {
          const leftF = this.priorities[left]!
          const rightF = this.priorities[right]!
          if (leftF !== rightF ? leftF > rightF : this.sequences[left]! >= this.sequences[right]!) {
            child = right
          }
        }
        const childF = this.priorities[child]!
        if (f !== childF ? f < childF : sequence < this.sequences[child]!) break
        this.priorities[index] = childF
        this.sequences[index] = this.sequences[child]!
        this.labels[index] = this.labels[child]!
        index = child
      }
      this.priorities[index] = f
      this.sequences[index] = sequence
      this.labels[index] = label
    }
    this.metrics.popped++
    return output
  }

  materializePath(goal: number, rows: number, cols: number): CompactA01Label[] {
    const reversed: number[] = []
    for (let label = goal; label >= 0; label = this.parents[label]!) {
      reversed.push(label)
    }
    const path: CompactA01Label[] = []
    const planeSize = rows * cols
    for (let index = reversed.length - 1; index >= 0; index--) {
      const label = reversed[index]!
      const cell = this.cells[label]!
      const z = Math.floor(cell / planeSize)
      const row = Math.floor((cell - z * planeSize) / cols)
      const col = cell - z * planeSize - row * cols
      path.push({ z, row, col, g: this.costs[label]!, parentIdx: path.length - 1, ripped: this.ripped[label]! })
    }
    this.metrics.materializedPathLabels += path.length
    return path
  }

  private getVictimMask(ripped: CompactA01RippedConnection | null): number {
    if (ripped === null) return 0
    if (ripped.compactMask !== undefined) {
      const cached = ripped.compactMask
      if ((cached >>> 0) !== cached || cached >= this.victimMaskLimit) {
        throw new Error(`Compact A01 cached victim mask outside N=${this.connectionCount}: ${cached}`)
      }
      return cached
    }
    let mask = 0
    let tail: CompactA01RippedConnection | null = ripped
    while (tail !== null && tail.compactMask === undefined) {
      if (!Number.isInteger(tail.id) || tail.id < 0 || tail.id >= this.connectionCount) {
        throw new Error(`Compact A01 victim ID outside [0, ${this.connectionCount - 1}]: ${tail.id}`)
      }
      mask |= 1 << tail.id
      tail = tail.prev
    }
    const cachedTail = tail?.compactMask ?? 0
    if ((cachedTail >>> 0) !== cachedTail || cachedTail >= this.victimMaskLimit) {
      throw new Error(`Compact A01 cached victim mask outside N=${this.connectionCount}: ${cachedTail}`)
    }
    mask = (mask | cachedTail) >>> 0
    ripped.compactMask = mask
    return mask
  }

  private growLabels(): void {
    const capacity = Math.max(64, this.cells.length * 2)
    if (capacity >= 2 ** 31) throw new Error("Compact A01 label arena exceeds Int32 parent capacity")
    const cells = new Uint32Array(capacity)
    const costs = new Float64Array(capacity)
    const parents = new Int32Array(capacity)
    cells.set(this.cells)
    costs.set(this.costs)
    parents.set(this.parents)
    this.cells = cells
    this.costs = costs
    this.parents = parents
  }

  private growHeap(): void {
    const capacity = Math.max(64, this.labels.length * 2)
    const priorities = new Float64Array(capacity)
    const sequences = new Float64Array(capacity)
    const labels = new Uint32Array(capacity)
    priorities.set(this.priorities)
    sequences.set(this.sequences)
    labels.set(this.labels)
    this.priorities = priorities
    this.sequences = sequences
    this.labels = labels
  }
}
