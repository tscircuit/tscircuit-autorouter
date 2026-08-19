import { expect, test } from "bun:test"
import {
  type DownstreamCandidateSummary,
  shouldSelectRegionCostOptimizedCandidate,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

const input: DownstreamCandidateSummary = {
  nodePfSum: 10,
  nodePfSquaredSum: 5,
  nodePfMax: 1,
  squaredNodePortPointCount: 1000,
  segmentCount: 100,
  layerChangeCount: 20,
}

test("region optimizer output must improve the downstream proxy without regressions", () => {
  expect(
    shouldSelectRegionCostOptimizedCandidate(input, {
      ...input,
      squaredNodePortPointCount: 900,
      segmentCount: 110,
    }),
  ).toBeTrue()
  expect(
    shouldSelectRegionCostOptimizedCandidate(input, {
      ...input,
      nodePfSum: 9,
      layerChangeCount: 21,
    }),
  ).toBeFalse()
  expect(
    shouldSelectRegionCostOptimizedCandidate(input, {
      ...input,
      squaredNodePortPointCount: 900,
      nodePfSquaredSum: 6,
    }),
  ).toBeFalse()
  expect(shouldSelectRegionCostOptimizedCandidate(input, input)).toBeFalse()
})
