import { expect, test } from "bun:test"
import {
  type DownstreamCandidateSummary,
  shouldEvaluateTraceDensityAlternative,
  shouldSelectTraceDensityAlternative,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("physical via portfolio requires strong trace dispersion without excessive local failure pressure", (): void => {
  const routeCount = 200
  const primary: DownstreamCandidateSummary = {
    nodePfSum: 2,
    nodePfSquaredSum: 0.6,
    nodePfMax: 0.5,
    squaredNodePortPointCount: 25_000,
    segmentCount: 2_000,
    layerChangeCount: 180,
    changedPreloadedTraceSectionCount: 0,
  }
  const alternative: DownstreamCandidateSummary = {
    ...primary,
    nodePfSum: 4,
    nodePfSquaredSum: 1.2,
    nodePfMax: 1,
    squaredNodePortPointCount: 17_000,
    segmentCount: 2_200,
    layerChangeCount: 110,
  }

  expect(
    shouldEvaluateTraceDensityAlternative(primary, routeCount, true),
  ).toBeTrue()
  expect(shouldEvaluateTraceDensityAlternative(primary, routeCount)).toBeFalse()
  expect(
    shouldEvaluateTraceDensityAlternative(
      { ...primary, squaredNodePortPointCount: 24_999 },
      routeCount,
      true,
    ),
  ).toBeFalse()

  expect(
    shouldSelectTraceDensityAlternative(primary, alternative, routeCount, true),
  ).toBeTrue()
  expect(
    shouldSelectTraceDensityAlternative(primary, alternative, routeCount),
  ).toBeFalse()
  expect(
    shouldSelectTraceDensityAlternative(
      primary,
      { ...alternative, squaredNodePortPointCount: 17_500 },
      routeCount,
      true,
    ),
  ).toBeFalse()
  expect(
    shouldSelectTraceDensityAlternative(
      primary,
      { ...alternative, nodePfMax: 1.01 },
      routeCount,
      true,
    ),
  ).toBeFalse()
  expect(
    shouldSelectTraceDensityAlternative(
      primary,
      { ...alternative, changedPreloadedTraceSectionCount: 1 },
      routeCount,
      true,
    ),
  ).toBeFalse()

  expect(
    shouldSelectTraceDensityAlternative(
      { ...primary, nodePfMax: 1.5 },
      { ...alternative, nodePfMax: 1.5 },
      routeCount,
      true,
    ),
  ).toBeTrue()
  expect(
    shouldSelectTraceDensityAlternative(
      { ...primary, nodePfMax: 1.5 },
      { ...alternative, nodePfMax: 1.51 },
      routeCount,
      true,
    ),
  ).toBeFalse()
})
