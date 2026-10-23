import { expect, test } from "bun:test"
import { setNewIntersectionCounts } from "tiny-hypergraph/lib/countNewIntersections"
import type { DynamicAnglePairArrays } from "tiny-hypergraph/lib/types"
import { createTinyCrossingIndexDiagnostics, TinyRegionCrossingIndex } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyRegionCrossingIndex"

test("crossing prefix parity exactly matches native strict endpoints, nets and layer masks across bit words", (): void => {
  const angles = [-113097, -2, -1, 0, 1, 2, 113097]
  const layers = [0, 1, 2, 3, 31]
  const queryAngles = Int32Array.from(angles.flatMap(angle => layers.map(() => angle)))
  const queryLayers = Int32Array.from(angles.flatMap(() => layers))
  const diagnostics = createTinyCrossingIndexDiagnostics(true)
  const cases: DynamicAnglePairArrays[] = []
  const endpoints: Array<[number, number, number, number]> = []
  for (const a of angles) for (const b of angles) for (const z of layers) {
    endpoints.push([endpoints.length % 3, a, b, (1 << z) | (1 << ((z + 1) & 31))])
  }
  for (const length of [0, 1, 2, 31, 32, 33, 63, 64, 65, 96, endpoints.length]) {
    const values = endpoints.slice(0, length)
    cases.push({
      netIds: Int32Array.from(values, row => row[0]),
      lesserAngles: Int32Array.from(values, row => row[1]),
      greaterAngles: Int32Array.from(values, row => row[2]),
      layerMasks: Int32Array.from(values, row => row[3]),
    })
  }
  for (const source of cases) {
    const before = structuredClone(source)
    const index = new TinyRegionCrossingIndex(source, queryAngles, queryLayers, diagnostics)
    for (let from = 0; from < queryAngles.length; from++) for (let to = 0; to < queryAngles.length; to++) for (const netId of [-1, 0, 1, 2, 99]) {
      const a = Math.min(queryAngles[from]!, queryAngles[to]!)
      const b = Math.max(queryAngles[from]!, queryAngles[to]!)
      const native = { netId, lesserAngle: a, greaterAngle: b, layerMask: (1 << queryLayers[from]!) | (1 << queryLayers[to]!), entryExitLayerChanges: Number(queryLayers[from] !== queryLayers[to]), sameLayerIntersectionCount: 0, crossingLayerIntersectionCount: 0 }
      setNewIntersectionCounts(source, native)
      index.count(from, to, netId)
      expect([index.sameLayerIntersectionCount, index.crossingLayerIntersectionCount]).toEqual([native.sameLayerIntersectionCount, native.crossingLayerIntersectionCount])
    }
    expect(source).toEqual(before)
    expect(index.matchesSource(source)).toBeTrue()
    for (const field of ["netIds", "lesserAngles", "greaterAngles", "layerMasks"] as const) {
      expect(index.matchesSource({ ...source, [field]: new Int32Array(source[field]) })).toBeFalse()
    }
  }
  expect(diagnostics.crossingIndexQueries).toBe(67375)
  expect(diagnostics.crossingIndexWordQueries).toBeGreaterThan(0)
})
