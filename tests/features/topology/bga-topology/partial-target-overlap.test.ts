import { expect, test } from "bun:test"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { createPartialTargetOverlapFixture } from "./fixtures/partial-target-overlap.fixture"

test("shows a BGA gap partially covered by a target on one layer", async () => {
  const fixture = createPartialTargetOverlapFixture()

  expect(fixture.initialTargetGap.availableZ).toEqual([0, 1, 2, 3, 4, 5])
  expect(fixture.outputTargetGapNodes.length).toBeGreaterThan(0)

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Physical input: BGA gap and two targets",
        step: 0,
        graphics: fixture.inputGraphics,
      },
      {
        name: "BGA topology after partial target overlap",
        step: 1,
        graphics: fixture.outputGraphics,
      },
    ],
    columns: 2,
    cellWidth: 2.4,
    cellHeight: 6.6,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
