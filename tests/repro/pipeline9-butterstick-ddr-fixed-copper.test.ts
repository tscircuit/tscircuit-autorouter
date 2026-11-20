import { expect, test } from "bun:test"
import { getNativeDdrBoardSnapshot } from "tests/fixtures/getNativeDdrBoardSnapshot"

test("routes the ButterStick DDR board beside completed data-byte copper", async (): Promise<void> => {
  const svg = getNativeDdrBoardSnapshot({
    boardName: "ButterStick",
    bounds: { minX: -24, maxX: 25, minY: -16, maxY: 16 },
    fixtureUrl: new URL(
      "../fixtures/assets/butterstick-native-ddr-handoff.srj.json.gz",
      import.meta.url,
    ),
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
