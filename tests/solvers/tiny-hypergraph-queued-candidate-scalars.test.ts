import { expect, test } from "bun:test"
import { type Candidate, IndexedCandidateHeap } from "tiny-hypergraph/lib/index"

type HeapGenerationState = {
  currentHopStateGeneration: number
  hopStateGeneration: Uint32Array
}

const candidate = (
  portId: number,
  nextRegionId: number,
  g: number,
  f: number,
  hopId?: number,
): Candidate => ({
  portId,
  nextRegionId,
  g,
  h: f - g,
  f,
  ...(hopId === undefined ? {} : { hopId }),
})

test("tiny hypergraph heap preserves immutable queued candidates, tie order, closure and generation reset", (): void => {
  const heap = new IndexedCandidateHeap(10)
  const first = candidate(1, 2, 10, 3)
  const second = candidate(2, 2, 8, 2)
  const third = candidate(3, 2, 10, 4)
  for (const item of [first, second, third]) {
    heap.queue(item)
    Object.freeze(item)
  }
  expect(first.hopId).toBe(12)
  heap.queue(candidate(1, 2, 5, 20))
  heap.queue(candidate(2, 2, 6, 7))
  heap.queue(candidate(1, 2, 4, 1))
  heap.queue(candidate(3, 2, 11, 0))
  expect(heap.toArray().map((item): number => item.portId)).toEqual([1, 3, 2])
  expect(heap.dequeue()?.portId).toBe(1)
  expect(heap.isClosedHopId(12)).toBe(true)
  heap.queue(candidate(1, 2, 0, -1))
  expect(heap.length).toBe(2)
  expect(heap.dequeue()?.portId).toBe(3)
  expect(heap.dequeue()?.portId).toBe(2)
  expect(heap.dequeue()).toBeUndefined()

  heap.clear()
  expect(heap.isClosedHop(1, 2)).toBe(false)
  for (let portId = 0; portId < 5; portId++) {
    const item = candidate(portId, 1, 0, 1)
    heap.queue(item)
    Object.freeze(item)
  }
  expect(
    Array.from({ length: 5 }, (): number | undefined => heap.dequeue()?.portId),
  ).toEqual([0, 4, 3, 2, 1])
  heap.clear()
  for (const item of [
    candidate(0, 1, 0, 1),
    candidate(1, 1, 0, 2),
    candidate(2, 1, 0, 2),
    candidate(3, 1, 0, 4),
  ]) {
    heap.queue(item)
    Object.freeze(item)
  }
  expect(
    Array.from({ length: 4 }, (): number | undefined => heap.dequeue()?.portId),
  ).toEqual([0, 1, 2, 3])

  heap.clear()
  const largePositive = candidate(7, 1, 0, 1, Number.MAX_SAFE_INTEGER - 2)
  const largeNegative = candidate(8, 1, 0, 1, -Number.MAX_SAFE_INTEGER)
  const smallest = candidate(9, 1, 0, -0)
  for (const item of [largePositive, largeNegative, smallest]) {
    heap.queue(item)
    Object.freeze(item)
  }
  expect(
    Array.from({ length: 3 }, (): number | undefined => heap.dequeue()?.portId),
  ).toEqual([9, 7, 8])
  expect(heap.isClosedHopId(Number.MAX_SAFE_INTEGER - 2)).toBe(true)
  expect(heap.isClosedHopId(-Number.MAX_SAFE_INTEGER)).toBe(true)

  const compact = new IndexedCandidateHeap(100, {
    hopCapacity: 9,
    hopSlotStride: 3,
    firstRegionByPortId: Int32Array.from([1, 2, 3]),
    secondRegionByPortId: Int32Array.from([11, 12, 13]),
    incidentPortRegion: [
      [1, 11, 21],
      [2, 12, 22],
      [3, 13, 23],
    ],
  })
  const compactSecondSlot = candidate(1, 12, 0, 3)
  const compactThirdSlot = candidate(0, 21, 0, 2)
  const nonincident = candidate(2, 99, 0, 1)
  for (const item of [compactSecondSlot, compactThirdSlot, nonincident]) {
    compact.queue(item)
    Object.freeze(item)
  }
  expect([
    compactSecondSlot.hopId,
    compactThirdSlot.hopId,
    nonincident.hopId,
  ]).toEqual([4, 2, -300])
  expect(
    Array.from(
      { length: 3 },
      (): number | undefined => compact.dequeue()?.portId,
    ),
  ).toEqual([2, 0, 1])
  expect(compact.isClosedHop(2, 99)).toBe(true)
  expect(compact.isClosedHopId(4)).toBe(true)
  const generation = compact as unknown as HeapGenerationState
  generation.currentHopStateGeneration = 0xffffffff
  generation.hopStateGeneration.fill(0xffffffff)
  compact.clear()
  expect(generation.currentHopStateGeneration).toBe(1)
  expect([...generation.hopStateGeneration]).toEqual(Array(9).fill(0))
  expect(compact.isClosedHopId(4)).toBe(false)
  expect(compact.isClosedHop(2, 99)).toBe(false)
  compact.queue(compactSecondSlot)
  expect(compact.dequeue()).toBe(compactSecondSlot)
})
