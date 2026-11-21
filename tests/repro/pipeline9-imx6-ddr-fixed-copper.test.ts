import { expect, test } from "bun:test"
import { getNativeDdrBoardSnapshot } from "tests/fixtures/getNativeDdrBoardSnapshot"

test("routes the i.MX6 DDR board beside completed data-byte copper", async (): Promise<void> => {
  const svg = getNativeDdrBoardSnapshot({
    boardName: "i.MX6",
    bounds: { minX: -19, maxX: 15, minY: -21, maxY: 20 },
    fixtureUrl: new URL(
      "../fixtures/assets/imx6-native-ddr-handoff.srj.json.gz",
      import.meta.url,
    ),
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
