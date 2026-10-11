import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { IndexedCandidateHeap, type CompactCandidateHopIndex } from "tiny-hypergraph/lib/indexed-candidate-heap"
import { PackedIndexedCandidateHeap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedIndexedCandidateHeap"

function createIndex(): CompactCandidateHopIndex {
  const incidentPortRegion = Array.from({ length: 12 }, (_, id) => [id % 5, (id + 1) % 5, (id + 2) % 5])
  return {
    hopCapacity: incidentPortRegion.length * 3, hopSlotStride: 3,
    firstRegionByPortId: Int32Array.from(incidentPortRegion, (regions) => regions[0]!),
    secondRegionByPortId: Int32Array.from(incidentPortRegion, (regions) => regions[1]!),
    incidentPortRegion,
  }
}

function makeCandidate(portId: number, nextRegionId: number, g: number, h: number): Candidate {
  const f = g + h
  return {
    portId, nextRegionId, g, h, f,
    prevRegionId: nextRegionId === 0 ? undefined : nextRegionId - 1,
    prevCandidate: undefined,
  }
}

function queuePair(original: IndexedCandidateHeap, packed: PackedIndexedCandidateHeap, candidate: Candidate, scalar: boolean): void {
  const expected = { ...candidate }
  original.queue(expected)
  if (scalar) {
    packed.queueValues(expected.hopId!, candidate.prevRegionId, candidate.nextRegionId,
      candidate.portId, candidate.g, candidate.h, candidate.f, candidate.prevCandidate)
  } else {
    packed.queue({ ...candidate })
  }
  expect(packed.toArray()).toEqual(original.toArray())
  expect(packed.length).toBe(original.length)
}

test("packed candidate heap retains native ties, replacements, closure, compact slots, and overflow growth", (): void => {
  for (const scalar of [false, true]) {
    const index = createIndex()
    const original = new IndexedCandidateHeap(5, index)
    const packed = new PackedIndexedCandidateHeap(5, index)
    for (let port = 0; port < 4; port++) queuePair(original, packed, makeCandidate(port, port % 5, 3, 1), scalar)
    const ties: number[] = []
    while (original.length > 0) {
      const expected = original.dequeue()!
      const actual = packed.dequeue()!
      expect(actual).toEqual(expected)
      ties.push(actual.portId)
      expect(packed.isClosedHopId(actual.hopId!)).toBe(true)
      queuePair(original, packed, makeCandidate(actual.portId, actual.nextRegionId, 0, 0), scalar)
    }
    expect(ties).toEqual([0, 3, 2, 1])
    expect(packed.dequeue()).toBeUndefined()
    original.clear()
    packed.clear()
    for (let port = 0; port < 12; port++) {
      for (let region = 0; region < 5; region++) {
        queuePair(original, packed, makeCandidate(port, region, 20 + port + region, 0), scalar)
      }
    }
    queuePair(original, packed, makeCandidate(0, 0, 20, -10), scalar)
    queuePair(original, packed, makeCandidate(0, 0, 19, 100), scalar)
    queuePair(original, packed, makeCandidate(1, 1, 1, 0), scalar)
    let seed = 0x12345678
    for (let step = 0; step < 1200; step++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const operation = seed % 23
      if (operation === 0) {
        original.clear()
        packed.clear()
      } else if (operation < 5) {
        expect(packed.dequeue()).toEqual(original.dequeue())
      } else {
        const port = (seed >>> 8) % 12
        const region = (seed >>> 16) % 5
        const g = (seed >>> 3) % 31 / 8
        const h = (seed >>> 23) % 41 / 4
        queuePair(original, packed, makeCandidate(port, region, g, h), scalar)
      }
      expect(packed.toArray()).toEqual(original.toArray())
      expect(packed.length).toBe(original.length)
      for (let port = 0; port < 12; port++) {
        for (let region = 0; region < 5; region++) {
          expect(packed.isClosedHop(port, region)).toBe(original.isClosedHop(port, region))
        }
      }
    }
    while (original.length > 0) expect(packed.dequeue()).toEqual(original.dequeue())
    expect(packed.length).toBe(0)
  }
})
