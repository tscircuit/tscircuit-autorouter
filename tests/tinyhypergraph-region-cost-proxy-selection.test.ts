import { expect, test } from "bun:test"
import {
  type DownstreamCandidateSummary,
  estimateHighDensityHardSearchProbability,
  getHighDensityFailureBurden,
  shouldSelectRegionCostOptimizedCandidate,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

const input: DownstreamCandidateSummary = {
  nodePfSum: 10,
  nodePfSquaredSum: 5,
  nodePfMax: 1,
  squaredNodePortPointCount: 1000,
  segmentCount: 100,
  layerChangeCount: 20,
  changedPreloadedTraceSectionCount: 0,
}

test("estimates hard-search probability from compounded node failure burden", () => {
  expect(getHighDensityFailureBurden(input)).toBe(12.5)
  expect(estimateHighDensityHardSearchProbability(input)).toBeCloseTo(0.628, 3)
  expect(
    estimateHighDensityHardSearchProbability({
      ...input,
      nodePfSum: 5,
      nodePfSquaredSum: 2,
    }),
  ).toBeLessThan(estimateHighDensityHardSearchProbability(input))
})

test("region optimizer output must meaningfully reduce estimated failure burden", () => {
  expect(
    shouldSelectRegionCostOptimizedCandidate(input, {
      ...input,
      squaredNodePortPointCount: 900,
      segmentCount: 110,
    }),
  ).toBeFalse()
  expect(
    shouldSelectRegionCostOptimizedCandidate(input, {
      ...input,
      nodePfSum: 9,
      nodePfSquaredSum: 4,
    }),
  ).toBeTrue()
  expect(
    shouldSelectRegionCostOptimizedCandidate(input, {
      ...input,
      nodePfSum: 8,
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
  expect(
    shouldSelectRegionCostOptimizedCandidate(input, {
      ...input,
      nodePfSum: 8,
      changedPreloadedTraceSectionCount: 1,
    }),
  ).toBeFalse()
  expect(shouldSelectRegionCostOptimizedCandidate(input, input)).toBeFalse()
})
