import { expect, test } from "bun:test"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { runSameNetCrossLayerTargetsFixture } from "./fixtures/same-net-cross-layer-targets.fixture"

test("visualizes a target over component-local free layers", async () => {
  const result = runSameNetCrossLayerTargetsFixture()

  expect(result.pathExists).toBe(result.hasMultilayerTarget)

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Physical copper input (unchanged by topology)",
        step: 1,
        graphics: result.physicalCopperGraphics,
      },
      {
        name: "Topology inputs (same XY scale)",
        step: 2,
        graphics: result.topologyInputGraphics,
      },
      {
        name: "Merged capacity regions (x/layer cross-section)",
        step: 3,
        graphics: result.capacityRegionGraphics,
      },
    ],
    columns: 1,
    cellWidth: 5.2,
    cellHeight: 2.4,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
