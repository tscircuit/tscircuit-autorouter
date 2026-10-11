import type { Candidate } from "tiny-hypergraph/lib/core"
import type { CompactCandidateHopIndex } from "tiny-hypergraph/lib/indexed-candidate-heap"

/**
 * Internal routing queue with numeric heap positions and one reusable candidate
 * record per directed hop. Queued priorities remain immutable until another
 * admission; scalar admissions only reference popped, closed predecessors.
 * Candidate views belong to the current search; clear() permits record reuse.
 */
export class PackedIndexedCandidateHeap {
  length = 0
  private heap: Int32Array
  private heapCosts: Float64Array
  private candidates: Array<Candidate | undefined>
  private bestG: Float64Array
  private candidateOwned: Uint8Array
  private bestF: Float64Array
  private hopGeneration: Uint32Array
  private hopIndexOrClosed: Int32Array
  private generation = 1
  private readonly overflowRecordByHopId = new Map<number, number>()
  private nextOverflowRecord: number

  constructor(
    private readonly regionCount: number,
    private readonly compactHopIndex: CompactCandidateHopIndex,
  ) {
    const capacity = compactHopIndex.hopCapacity + 16
    if (!Number.isSafeInteger(capacity) || capacity < 16 || capacity > 0x7fffffff) {
      throw new Error("Packed candidate arena exceeds Int32 index capacity")
    }
    this.heap = new Int32Array(capacity)
    this.heapCosts = new Float64Array(capacity)
    this.candidates = new Array(capacity)
    this.bestG = new Float64Array(capacity)
    this.candidateOwned = new Uint8Array(capacity)
    this.bestF = new Float64Array(capacity)
    this.hopGeneration = new Uint32Array(capacity)
    this.hopIndexOrClosed = new Int32Array(capacity)
    this.nextOverflowRecord = compactHopIndex.hopCapacity
  }

  toArray(): Candidate[] {
    const result: Candidate[] = []
    for (let position = 0; position < this.length; position++) {
      const record = this.heap[position]!
      result.push(this.candidates[record]!)
    }
    return result
  }

  clear(): void {
    this.length = 0
    // Retain arena records, but a different generation makes every hop unseen.
    // Previously popped records can therefore only be reused by a new search.
    if (this.generation === 0xffffffff) {
      this.hopGeneration.fill(0)
      this.generation = 1
    } else {
      this.generation += 1
    }
  }

  isClosedHop(portId: number, nextRegionId: number): boolean {
    const hopId = this.getHopIdFromValues(portId, nextRegionId)
    const record = this.getRecordId(hopId, false)
    if (record === undefined) return false
    return this.hopGeneration[record] === this.generation &&
      this.hopIndexOrClosed[record] === -1
  }

  isClosedHopId(hopId: number): boolean {
    const record = this.getRecordId(hopId, false)
    if (record === undefined) return false
    const sameGeneration = this.hopGeneration[record] === this.generation
    const closed = this.hopIndexOrClosed[record] === -1
    return sameGeneration && closed
  }

  queue(candidate: Candidate): void {
    const hopId = candidate.hopId ?? this.getHopIdFromValues(candidate.portId, candidate.nextRegionId)
    candidate.hopId = hopId
    const record = this.getRecordId(hopId, true)!
    const previousIndex = this.getQueuedIndex(record)
    if (previousIndex === -1) return
    if (previousIndex !== undefined && candidate.g >= this.bestG[record]!) return
    const oldF = this.bestF[record]!
    // Public queue preserves the supplied object and its predecessor references.
    this.candidates[record] = candidate
    this.candidateOwned[record] = 0
    this.bestG[record] = candidate.g
    this.bestF[record] = candidate.f
    this.insertOrReplace(record, previousIndex, oldF)
  }

  queueValues(
    hopId: number, prevRegionId: number | undefined, nextRegionId: number,
    portId: number, g: number, h: number, f: number,
    prevCandidate: Candidate | undefined,
  ): void {
    const record = this.getRecordId(hopId, true)!
    const previousIndex = this.getQueuedIndex(record)
    if (previousIndex === -1) return
    if (previousIndex !== undefined && g >= this.bestG[record]!) return
    const oldF = this.bestF[record]!
    let candidate = this.candidates[record]
    if (!candidate || this.candidateOwned[record] !== 1) {
      candidate = { hopId, prevRegionId, nextRegionId, portId, g, h, f, prevCandidate }
      this.candidates[record] = candidate
      this.candidateOwned[record] = 1
    } else {
      // Only open records change during a search. A popped predecessor remains
      // immutable until clear() begins a separate route search.
      candidate.hopId = hopId
      candidate.prevRegionId = prevRegionId
      candidate.nextRegionId = nextRegionId
      candidate.portId = portId
      candidate.g = g
      candidate.h = h
      candidate.f = f
      candidate.prevCandidate = prevCandidate
    }
    this.bestG[record] = g
    this.bestF[record] = f
    this.insertOrReplace(record, previousIndex, oldF)
  }

  dequeue(): Candidate | undefined {
    if (this.length === 0) return undefined
    const bestRecord = this.heap[0]!
    this.hopGeneration[bestRecord] = this.generation
    this.hopIndexOrClosed[bestRecord] = -1
    this.length -= 1
    if (this.length > 0) {
      this.heap[0] = this.heap[this.length]!
      this.heapCosts[0] = this.heapCosts[this.length]!
      this.siftDown(0)
    }
    return this.candidates[bestRecord]!
  }

  private insertOrReplace(record: number, previousIndex: number | undefined, oldF: number): void {
    const f = this.bestF[record]!
    if (previousIndex !== undefined) {
      this.heap[previousIndex] = record
      this.heapCosts[previousIndex] = f
      if (f <= oldF) this.siftUp(previousIndex)
      else this.siftDown(previousIndex)
      return
    }
    const position = this.length
    this.length += 1
    this.heap[position] = record
    this.heapCosts[position] = f
    this.siftUp(position)
  }

  private getQueuedIndex(record: number): number | undefined {
    const sameGeneration = this.hopGeneration[record] === this.generation
    if (!sameGeneration) return undefined
    const indexOrClosed = this.hopIndexOrClosed[record]!
    if (indexOrClosed === -1) return -1
    if (indexOrClosed < 0 || indexOrClosed >= this.length) {
      throw new Error("Packed candidate arena has an invalid heap position")
    }
    return indexOrClosed
  }

  private getRecordId(hopId: number, create: boolean): number | undefined {
    if (!Number.isSafeInteger(hopId)) throw new Error("Packed candidate hop must be a safe integer")
    if (hopId >= 0) {
      if (hopId >= this.compactHopIndex.hopCapacity) {
        throw new Error("Packed candidate hop exceeds compact capacity")
      }
      return hopId
    }
    let record = this.overflowRecordByHopId.get(hopId)
    if (record === undefined && create) {
      record = this.nextOverflowRecord++
      this.ensureCapacity(record + 1)
      this.overflowRecordByHopId.set(hopId, record)
    }
    return record
  }

  private getHopIdFromValues(portId: number, nextRegionId: number): number {
    const index = this.compactHopIndex
    const baseHopId = portId * index.hopSlotStride
    if (index.firstRegionByPortId[portId] === nextRegionId) return baseHopId
    if (index.secondRegionByPortId[portId] === nextRegionId) return baseHopId + 1
    const regions = index.incidentPortRegion[portId]
    for (let slot = 2; slot < (regions?.length ?? 0); slot++) {
      if (regions![slot] === nextRegionId) return baseHopId + slot
    }
    return -(portId * this.regionCount + nextRegionId) - 1
  }

  private ensureCapacity(required: number): void {
    if (required <= this.bestG.length) return
    const capacity = Math.max(required, this.bestG.length * 2)
    if (!Number.isSafeInteger(capacity) || capacity > 0x7fffffff) {
      throw new Error("Packed candidate arena exceeds Int32 index capacity")
    }
    const heap = new Int32Array(capacity)
    heap.set(this.heap)
    const heapCosts = new Float64Array(capacity)
    heapCosts.set(this.heapCosts)
    const bestG = new Float64Array(capacity)
    bestG.set(this.bestG)
    const candidateOwned = new Uint8Array(capacity)
    candidateOwned.set(this.candidateOwned)
    const bestF = new Float64Array(capacity)
    bestF.set(this.bestF)
    const hopGeneration = new Uint32Array(capacity)
    hopGeneration.set(this.hopGeneration)
    const hopIndexOrClosed = new Int32Array(capacity)
    hopIndexOrClosed.set(this.hopIndexOrClosed)
    this.heap = heap
    this.heapCosts = heapCosts
    this.bestG = bestG
    this.candidateOwned = candidateOwned
    this.bestF = bestF
    this.hopGeneration = hopGeneration
    this.hopIndexOrClosed = hopIndexOrClosed
    this.candidates.length = capacity
  }

  private siftUp(startIndex: number): void {
    const record = this.heap[startIndex]!
    const f = this.heapCosts[startIndex]!
    let index = startIndex
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parentF = this.heapCosts[parentIndex]!
      if (parentF <= f) break
      const parentRecord = this.heap[parentIndex]!
      this.heap[index] = parentRecord
      this.heapCosts[index] = parentF
      this.hopGeneration[parentRecord] = this.generation
      this.hopIndexOrClosed[parentRecord] = index
      index = parentIndex
    }
    this.heap[index] = record
    this.heapCosts[index] = f
    this.hopGeneration[record] = this.generation
    this.hopIndexOrClosed[record] = index
  }

  private siftDown(startIndex: number): void {
    const record = this.heap[startIndex]!
    const f = this.heapCosts[startIndex]!
    let index = startIndex
    while (true) {
      const left = index * 2 + 1
      if (left >= this.length) break
      const right = left + 1
      const child = right < this.length && this.heapCosts[right]! < this.heapCosts[left]!
        ? right : left
      const childF = this.heapCosts[child]!
      if (f <= childF) break
      const childRecord = this.heap[child]!
      this.heap[index] = childRecord
      this.heapCosts[index] = childF
      this.hopGeneration[childRecord] = this.generation
      this.hopIndexOrClosed[childRecord] = index
      index = child
    }
    this.heap[index] = record
    this.heapCosts[index] = f
    this.hopGeneration[record] = this.generation
    this.hopIndexOrClosed[record] = index
  }
}
