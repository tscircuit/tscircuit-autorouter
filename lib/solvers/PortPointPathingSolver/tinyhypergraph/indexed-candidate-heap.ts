import type { Candidate } from "tiny-hypergraph/lib/index"

/**
 * Candidate queue keyed by the directed hop represented by a candidate.
 *
 * A queued hop has at most one entry. A lower-cost candidate replaces the
 * existing entry in place, and a dequeued hop is closed until the queue is
 * cleared for the next route search.
 */
export class IndexedCandidateHeap {
  private items: Candidate[] = []
  private indexByHopId = new Map<number, number>()
  private closedHopIds = new Set<number>()

  constructor(private readonly regionCount: number) {}

  get length(): number {
    return this.items.length
  }

  toArray(): Candidate[] {
    return [...this.items]
  }

  clear(): void {
    this.items.length = 0
    this.indexByHopId.clear()
    this.closedHopIds.clear()
  }

  queue(candidate: Candidate): void {
    const hopId = this.getHopId(candidate)
    if (this.closedHopIds.has(hopId)) return

    const existingIndex = this.indexByHopId.get(hopId)
    if (existingIndex !== undefined) {
      const existingCandidate = this.items[existingIndex]!
      if (candidate.g >= existingCandidate.g) return

      this.items[existingIndex] = candidate
      if (candidate.f <= existingCandidate.f) {
        this.siftUp(existingIndex)
      } else {
        this.siftDown(existingIndex)
      }
      return
    }

    const index = this.items.length
    this.items.push(candidate)
    this.indexByHopId.set(hopId, index)
    this.siftUp(index)
  }

  dequeue(): Candidate | undefined {
    const bestCandidate = this.items[0]
    if (!bestCandidate) return undefined

    const bestHopId = this.getHopId(bestCandidate)
    this.closedHopIds.add(bestHopId)
    this.indexByHopId.delete(bestHopId)

    const lastCandidate = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastCandidate
      this.indexByHopId.set(this.getHopId(lastCandidate), 0)
      this.siftDown(0)
    }
    return bestCandidate
  }

  private getHopId(candidate: Candidate): number {
    return candidate.portId * this.regionCount + candidate.nextRegionId
  }

  private swap(leftIndex: number, rightIndex: number): void {
    const leftCandidate = this.items[leftIndex]!
    this.items[leftIndex] = this.items[rightIndex]!
    this.items[rightIndex] = leftCandidate
    this.indexByHopId.set(this.getHopId(this.items[leftIndex]!), leftIndex)
    this.indexByHopId.set(this.getHopId(this.items[rightIndex]!), rightIndex)
  }

  private siftUp(startIndex: number): void {
    let index = startIndex
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      if (this.items[parentIndex]!.f <= this.items[index]!.f) return
      this.swap(index, parentIndex)
      index = parentIndex
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex
    while (true) {
      const leftChildIndex = index * 2 + 1
      if (leftChildIndex >= this.items.length) return

      const rightChildIndex = leftChildIndex + 1
      const smallestChildIndex =
        rightChildIndex < this.items.length &&
        this.items[rightChildIndex]!.f < this.items[leftChildIndex]!.f
          ? rightChildIndex
          : leftChildIndex
      if (this.items[index]!.f <= this.items[smallestChildIndex]!.f) return
      this.swap(index, smallestChildIndex)
      index = smallestChildIndex
    }
  }
}
