import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { PackedIndexedCandidateHeap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedIndexedCandidateHeap"

function createHeap(): PackedIndexedCandidateHeap {
  const incidentPortRegion = Array.from({ length: 8 }, () => [0, 1])
  return new PackedIndexedCandidateHeap(3, {
    hopCapacity: 16, hopSlotStride: 2, incidentPortRegion,
    firstRegionByPortId: new Int32Array(8),
    secondRegionByPortId: new Int32Array(8).fill(1),
  })
}

function snapshot(candidate: Candidate): number[] {
  const result: number[] = []
  for (let current: Candidate | undefined = candidate; current; current = current.prevCandidate) {
    result.push(current.hopId!, current.portId, current.nextRegionId, current.g, current.h, current.f)
  }
  return result
}

test("packed queued replacements preserve popped predecessors and supplied public candidate objects within a search", (): void => {
  const heap = createHeap()
  heap.queueValues(0, undefined, 0, 0, 0, 0, 0, undefined)
  const root = heap.dequeue()!
  const rootSnapshot = snapshot(root)
  heap.queueValues(2, 0, 1, 1, 10, 1, 11, root)
  heap.queueValues(4, 0, 1, 2, 2, 0, 2, root)
  const parent = heap.dequeue()!
  const parentSnapshot = snapshot(parent)
  heap.queueValues(6, 1, 1, 3, 4, 0, 4, parent)
  heap.queueValues(2, 1, 1, 1, 3, 50, 53, parent)
  heap.queueValues(2, 1, 1, 1, 1, 0, 1, root)
  const replacement = heap.dequeue()!
  expect(replacement.portId).toBe(1)
  expect(replacement.g).toBe(1)
  expect(replacement.prevCandidate).toBe(root)
  const child = heap.dequeue()!
  expect(child.prevCandidate).toBe(parent)
  expect(child.prevCandidate!.prevCandidate).toBe(root)
  expect(snapshot(root)).toEqual(rootSnapshot)
  expect(snapshot(parent)).toEqual(parentSnapshot)
  heap.queueValues(parent.hopId!, 0, 1, 2, -20, 0, -20, root)
  expect(heap.length).toBe(0)
  expect(snapshot(parent)).toEqual(parentSnapshot)
  const publicCandidate: Candidate = { hopId: 8, portId: 4, nextRegionId: 0, g: 8, h: 0, f: 8, prevCandidate: root }
  const retained = { ...publicCandidate }
  heap.queue(publicCandidate)
  heap.queueValues(8, 1, 1, 4, 7, 9, 16, parent)
  expect(publicCandidate).toEqual(retained)
  expect(heap.dequeue()!.prevCandidate).toBe(parent)
})
