import { expect, test } from "bun:test"
import { getNativeDdrBoardSnapshot } from "tests/fixtures/getNativeDdrBoardSnapshot"

test("routes the iCEPi DDR board after both byte lanes", async (): Promise<void> => {
  const svg = getNativeDdrBoardSnapshot({
    boardName: "iCEPi",
    bounds: { minX: -1, maxX: 30, minY: -10, maxY: 23 },
    fixtureUrl: new URL(
      "../fixtures/assets/icepi-native-ddr-gap-ports.srj.json.gz",
      import.meta.url,
    ),
  })
  expect(svg).toContain("50/50 nets connected")
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
