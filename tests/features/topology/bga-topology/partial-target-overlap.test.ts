import { expect, test } from "bun:test"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { createPartialTargetOverlapFixture } from "./fixtures/partial-target-overlap.fixture"

test("provides via-sized cross-layer access inside a partially covered target", async () => {
  const fixture = createPartialTargetOverlapFixture()

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: exact mst25 geometry",
        step: 0,
        graphics: fixture.inputGraphics,
      },
      {
        name: "Output: merged regions",
        step: 1,
        graphics: fixture.outputGraphics,
      },
    ],
    columns: 2,
    cellWidth: 2.4,
    cellHeight: 2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
  expect(fixture.accessRegions.length).toBeGreaterThan(0)
})
