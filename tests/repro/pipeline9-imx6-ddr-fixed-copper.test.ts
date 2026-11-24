import { expect, test } from "bun:test"
import { getNativeDdrBoardSnapshot } from "tests/fixtures/getNativeDdrBoardSnapshot"

test("shows i.MX6 DDR routing after 100,000 pipeline steps", async (): Promise<void> => {
  const svg = getNativeDdrBoardSnapshot({
    boardName: "i.MX6 after 100k steps",
    maxIterations: 100_000,
    bounds: { minX: -19, maxX: 15, minY: -21, maxY: 20 },
    fixtureUrl: new URL(
      "../fixtures/assets/imx6-native-ddr-handoff.srj.json.gz",
      import.meta.url,
    ),
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
