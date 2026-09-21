import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { IndexedCandidateHeap, type CompactCandidateHopIndex } from "tiny-hypergraph/lib/indexed-candidate-heap"

type GenerationAccess = { currentHopStateGeneration: number }
type QueueOperation = { type: "queue"; candidate: Candidate } | { type: "dequeue" } | { type: "clear"; wrap?: boolean }

const candidate = (
  portId: number,
  nextRegionId: number,
  g: number,
  f: number,
): Candidate => ({ portId, nextRegionId, g, f, h: f - g })

test("dense hop state preserves map-mode behavior across improvements, closed hops, overflow hops and generation resets", (): void => {
  const compact: CompactCandidateHopIndex = {
    hopCapacity: 12,
    hopSlotStride: 3,
    firstRegionByPortId: Int32Array.from([0, 1, 2, 3]),
    secondRegionByPortId: Int32Array.from([1, 2, 3, 4]),
    incidentPortRegion: [[0, 1, 2], [1, 2, 3], [2, 3, 4], [3, 4, 5]],
  }
  const dense = new IndexedCandidateHeap(7, compact)
  const map = new IndexedCandidateHeap(7)
  const operations: QueueOperation[] = [
    { type: "queue", candidate: candidate(0, 0, 10, 20) },
    { type: "queue", candidate: candidate(1, 2, 10, 20) },
    { type: "queue", candidate: candidate(0, 2, 15, 25) },
    { type: "queue", candidate: candidate(0, 6, 5, 10) },
    { type: "queue", candidate: candidate(0, 0, 8, 9) },
    { type: "queue", candidate: candidate(1, 2, 8, 30) },
    { type: "queue", candidate: candidate(0, 2, 15, 1) },
    { type: "dequeue" },
    { type: "queue", candidate: candidate(0, 0, 1, 1) },
    { type: "dequeue" },
    { type: "queue", candidate: candidate(0, 6, 1, 1) },
    { type: "clear" },
    { type: "queue", candidate: candidate(0, 0, 1, 1) },
    { type: "queue", candidate: candidate(0, 6, 1, 1) },
    { type: "dequeue" },
    { type: "clear", wrap: true },
  ]
  let seed = 4291
  for (let index = 0; index < 1000; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    if (index % 137 === 0) {
      operations.push({ type: "clear", wrap: index % 274 === 0 })
    } else if (seed % 5 === 0) {
      operations.push({ type: "dequeue" })
    } else {
      operations.push({ type: "queue", candidate: candidate(seed % 4, (seed >>> 8) % 7, (seed >>> 16) % 31, (seed >>> 24) % 31) })
    }
  }
  for (const operation of operations) {
    if (operation.type === "queue") {
      dense.queue(operation.candidate)
      map.queue(operation.candidate)
    } else if (operation.type === "dequeue") {
      expect(dense.dequeue()).toEqual(map.dequeue())
    } else {
      if (operation.wrap) {
        (dense as unknown as GenerationAccess).currentHopStateGeneration = 0xffffffff
      }
      dense.clear()
      map.clear()
    }
    expect(dense.toArray()).toEqual(map.toArray())
    expect(dense.length).toBe(map.length)
    for (let portId = 0; portId < 4; portId++) {
      for (let regionId = 0; regionId < 7; regionId++) {
        expect(dense.isClosedHop(portId, regionId)).toBe(map.isClosedHop(portId, regionId))
      }
    }
  }
  while (map.length > 0) expect(dense.dequeue()).toEqual(map.dequeue())
  expect(dense.dequeue()).toBeUndefined()
})
