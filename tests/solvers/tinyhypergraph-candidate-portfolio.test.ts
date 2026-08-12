import { expect, test } from "bun:test"
import {
  shouldEvaluateTraceDensityAlternative,
  shouldSelectTraceDensityAlternative,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

const candidate = (
  overrides: Partial<{
    nodePfSum: number
    nodePfSquaredSum: number
    nodePfMax: number
    squaredNodePortPointCount: number
    segmentCount: number
    layerChangeCount: number
  }> = {},
) => ({
  nodePfSum: 5,
  nodePfSquaredSum: 3,
  nodePfMax: 1.1,
  squaredNodePortPointCount: 5_000,
  segmentCount: 400,
  layerChangeCount: 20,
  ...overrides,
})

test("trace-density portfolio requires downstream pressure and scale-aware concentration improvement", () => {
  expect(shouldEvaluateTraceDensityAlternative(candidate(), 40)).toBe(true)
  expect(
    shouldEvaluateTraceDensityAlternative(candidate({ nodePfMax: 1 }), 40),
  ).toBe(false)

  expect(
    shouldSelectTraceDensityAlternative(
      candidate(),
      candidate({
        nodePfSum: 5.1,
        nodePfSquaredSum: 3.1,
        squaredNodePortPointCount: 4_700,
      }),
      40,
    ),
  ).toBe(true)
  expect(
    shouldSelectTraceDensityAlternative(
      candidate(),
      candidate({
        nodePfSum: 5.1,
        nodePfSquaredSum: 3.1,
        squaredNodePortPointCount: 4_700,
      }),
      41,
    ),
  ).toBe(false)
  expect(
    shouldSelectTraceDensityAlternative(
      candidate(),
      candidate({
        nodePfSum: 5.2,
        nodePfSquaredSum: 3,
        squaredNodePortPointCount: 4_000,
      }),
      40,
    ),
  ).toBe(false)
  expect(
    shouldSelectTraceDensityAlternative(
      candidate(),
      candidate({
        nodePfSum: 5,
        nodePfSquaredSum: 3.2,
        squaredNodePortPointCount: 4_000,
      }),
      40,
    ),
  ).toBe(false)
})
