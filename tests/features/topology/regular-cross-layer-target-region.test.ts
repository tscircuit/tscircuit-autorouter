import { expect, test } from "bun:test"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { runRegularCrossLayerTargetRegionFixture } from "./fixtures/regular-cross-layer-target-region.fixture"

test("visualizes cross-layer target region alignment", async () => {
  const result = runRegularCrossLayerTargetRegionFixture()
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Exact topology input",
        step: 0,
        graphics: result.inputGraphics,
      },
      {
        name: result.outputTitle,
        step: 1,
        graphics: result.outputGraphics,
      },
    ],
    columns: 2,
    cellWidth: 1.65,
    cellHeight: 2.2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
