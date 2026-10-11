import { expect, test } from "bun:test"
import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyTriangularDistanceIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyTriangularDistanceIndex"

function fixture(count: number): TinyHyperGraphTopology {
  return {
    regionCount: 2, portCount: count,
    regionIncidentPorts: [Array.from({ length: count }, (_, i) => i), Array.from({ length: count }, (_, i) => count - i - 1)],
    incidentPortRegion: Array.from({ length: count }, () => [0, 1]),
    regionWidth: new Float64Array([3, 2]), regionHeight: new Float64Array([2, 3]),
    regionCenterX: new Float64Array(2), regionCenterY: new Float64Array(2),
    portX: Float64Array.from({ length: count }, (_, i) => i * 0.1),
    portY: Float64Array.from({ length: count }, (_, i) => (i % 7) * 0.3),
    portZ: new Int32Array(count), portAngleForRegion1: new Int32Array(count),
  }
}

test("triangular distances preserve exact mutable coordinates, shared topology, epoch wraps and explicit memory eligibility", (): void => {
  const topology = fixture(69)
  const index = TinyTriangularDistanceIndex.forTopology(topology)!
  expect(TinyTriangularDistanceIndex.forTopology(topology)).toBe(index)
  const metadata = topology.portCount * 36 + topology.regionCount * 12
  const budget = metadata + 69 * 68 / 2 * 12
  const partial = TinyTriangularDistanceIndex.forTopology(topology, budget)!
  expect(partial.byteLength).toBe(budget)
  expect(index.byteLength).toBe(metadata + 69 * 68 * 12)
  expect(TinyTriangularDistanceIndex.forTopology(topology, metadata - 1)).toBeUndefined()
  let seed = 0x81128abc
  let queries = 0
  for (let round = 0; round < 200; round++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const source = seed % topology.portCount
    const destination = (seed >>> 9) % topology.portCount
    if (round % 7 === 0) topology.portX[destination] += 0.125
    if (round % 11 === 0) topology.portY[source] -= 0.25
    if (round % 13 === 0) {
      topology.portX = topology.portX.slice()
      topology.portY = topology.portY.slice()
    }
    for (const cache of [index, partial]) {
      for (const region of [0, 1]) {
        const x = topology.portX[source]!, y = topology.portY[source]!
        const revision = cache.refreshPort(source, x, y)
        const wrap = cache.wrapGeneration
        const from = cache.getSourceLocalIndex(source, region)
        const to = cache.getSourceLocalIndex(destination, region)
        const dx = x - topology.portX[destination]!, dy = y - topology.portY[destination]!
        const expected = Math.sqrt(dx * dx + dy * dy)
        for (let repeat = 0; repeat < 3; repeat++) {
          const actual = cache.getDistance(region, from, source, revision, wrap, x, y,
            to, destination, topology.portX[destination]!, topology.portY[destination]!)
          expect(Object.is(actual, expected)).toBe(true)
          queries++
        }
      }
    }
  }
  for (const value of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.25, 0, 1.25]) {
    topology.portX[0] = value
    const revision = index.refreshPort(0, value, topology.portY[0]!)
    const dx = value - topology.portX[1]!, dy = topology.portY[0]! - topology.portY[1]!
    const result = index.getDistance(0, 0, 0, revision, index.wrapGeneration, value, topology.portY[0]!,
      1, 1, topology.portX[1]!, topology.portY[1]!)
    expect(Object.is(result, Math.sqrt(dx * dx + dy * dy))).toBe(true)
  }
  topology.portX[0] = 2
  const oldRevision = index.refreshPort(0, 2, topology.portY[0]!)
  const oldWrap = index.wrapGeneration
  index.refreshPort(0, 3, topology.portY[0]!)
  index.refreshPort(1, 4, topology.portY[1]!)
  const freshRevision = index.refreshPort(0, 3, topology.portY[0]!)
  index.getDistance(0, 0, 0, freshRevision, oldWrap, 3, topology.portY[0]!, 1, 1, 4, topology.portY[1]!)
  const captured = index.getDistance(0, 0, 0, oldRevision, oldWrap, 2, topology.portY[0]!, 1, 1, 4, topology.portY[1]!)
  const capturedDy = topology.portY[0]! - topology.portY[1]!
  expect(captured).toBe(Math.sqrt(4 + capturedDy * capturedDy))
  ;(index as unknown as { epoch: number }).epoch = 0xffffffff
  const beforeWrap = index.wrapGeneration
  index.refreshPort(1, 8, topology.portY[1]!)
  const wrapped = index.getDistance(0, 0, 0, freshRevision, beforeWrap, 3, topology.portY[0]!, 1, 1, 8, topology.portY[1]!)
  expect(wrapped).toBe(Math.sqrt(25 + capturedDy * capturedDy))
  expect(index.wrapGeneration).toBe(beforeWrap + 1)
  const nested = TinyTriangularDistanceIndex.forTopology(fixture(3))!
  const nestedState = nested as unknown as { epoch: number }
  const capturedRevision = nested.refreshPort(0, 0, 0)
  const capturedWrap = nested.wrapGeneration
  nestedState.epoch = 0xffffffff
  nested.refreshPort(2, 3, 0)
  nested.refreshPort(0, 3, 0)
  nestedState.epoch = 0xfffffffd
  nested.refreshPort(1, 4, 0)
  nestedState.epoch = 0xffffffff
  expect(nested.getDistance(0, 0, 0, capturedRevision, capturedWrap, 0, 0, 1, 1, 4, 0)).toBe(4)
  const currentRevision = nested.refreshPort(0, 0, 0)
  const currentWrap = nested.wrapGeneration
  nestedState.epoch = 0xfffffffd
  expect(nested.getDistance(0, 0, 0, currentRevision, currentWrap, 0, 0, 1, 1, 5, 0)).toBe(5)
  expect(index.byteLength).toBeLessThanOrEqual(64 * 1024 * 1024)
  expect(queries).toBe(2400)
})
