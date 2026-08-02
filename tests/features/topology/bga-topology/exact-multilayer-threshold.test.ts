import { expect, test } from "bun:test"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { createExactMultilayerThresholdFixture } from "./fixtures/exact-multilayer-threshold.fixture"

test("shows multilayer topology for equal BGA gaps", async () => {
  const fixture = createExactMultilayerThresholdFixture()
  const physicalGaps = [
    ...new Map(
      fixture.diagonalGapNodes.map((node) => [
        `${node.center.x}:${node.center.y}`,
        node,
      ]),
    ).values(),
  ]

  expect(physicalGaps).toHaveLength(2)
  expect(
    Math.abs(physicalGaps[0]!.width - physicalGaps[1]!.width),
  ).toBeLessThan(1e-12)
  expect(
    Math.abs(physicalGaps[0]!.width - fixture.multilayerThreshold),
  ).toBeLessThan(1e-12)

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: equal physical BGA gaps",
        step: 0,
        graphics: fixture.physicalGapGraphics,
      },
      {
        name: "Generated topology from those gaps",
        step: 1,
        graphics: fixture.topologyIdentityGraphics,
      },
    ],
    columns: 2,
    cellWidth: 4.2,
    cellHeight: 6.8,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
