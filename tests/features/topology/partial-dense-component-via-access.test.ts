import { expect, test } from "bun:test"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { runPartialDenseComponentViaAccessFixture } from "./fixtures/partial-dense-component-via-access.fixture"

test("visualizes via access at a partially detected dense component", async () => {
  const result = runPartialDenseComponentViaAccessFixture()
  const targetNodes = result.nodes.filter((node) => node._containsTarget)

  expect(result.nodes).toHaveLength(4)
  expect(result.pathExists).toBe(
    targetNodes.every((node) => node.availableZ.length === 2),
  )

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Actual XY node bounds: via-sized overlap",
        step: 1,
        graphics: result.physicalGraphics,
      },
      {
        name: `Logical graph (not PCB distance): edge ${result.pathExists ? "created" : "missing"}`,
        step: 1,
        graphics: result.graphGraphics,
      },
    ],
    columns: 1,
    cellWidth: 5.2,
    cellHeight: 2.2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
