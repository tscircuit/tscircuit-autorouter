import { expect, test } from "bun:test"
import { PackedIndexedCandidateHeap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedIndexedCandidateHeap"

function createHeap(): PackedIndexedCandidateHeap {
  return new PackedIndexedCandidateHeap(4, {
    hopCapacity: 6, hopSlotStride: 2,
    incidentPortRegion: [[0, 1], [1, 2], [2, 3]],
    firstRegionByPortId: new Int32Array([0, 1, 2]),
    secondRegionByPortId: new Int32Array([1, 2, 3]),
  })
}

test("packed generation wrap clears old closed and queued compact and overflow hops", (): void => {
  const heap = createHeap()
  const probe = heap as unknown as { generation: number; hopGeneration: Uint32Array }
  heap.queueValues(0, undefined, 0, 0, 0, 0, 0, undefined)
  expect(heap.dequeue()!.hopId).toBe(0)
  expect(heap.isClosedHopId(0)).toBe(true)
  probe.generation = 0xffffffff
  for (const hop of [2, 4, -4, -8]) {
    heap.queueValues(hop, undefined, 0, 0, Math.abs(hop), 0, Math.abs(hop), undefined)
  }
  expect(heap.dequeue()!.hopId).toBe(2)
  expect(heap.isClosedHopId(2)).toBe(true)
  heap.clear()
  expect(probe.generation).toBe(1)
  expect([...probe.hopGeneration]).toEqual(Array(probe.hopGeneration.length).fill(0))
  expect(heap.length).toBe(0)
  expect(heap.toArray()).toEqual([])
  for (const hop of [0, 2, 4, -4, -8]) {
    expect(heap.isClosedHopId(hop)).toBe(false)
    heap.queueValues(hop, undefined, 0, 0, 100 + Math.abs(hop), 0, 100 + Math.abs(hop), undefined)
  }
  expect(heap.length).toBe(5)
  const found = new Set<number>()
  while (heap.length > 0) found.add(heap.dequeue()!.hopId!)
  expect(found).toEqual(new Set([0, 2, 4, -4, -8]))
})
