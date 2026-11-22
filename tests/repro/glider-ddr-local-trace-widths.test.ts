import { expect, test } from "bun:test"
import { getDdrLocalWidthSnapshots } from "tests/fixtures/getDdrLocalWidthSnapshots"

test("measures Glider ADDR3 copper at its requested DDR width", async (): Promise<void> => {
  const { boardSvg, traceSvg, traceLengthMm, traceNominalMm } =
    getDdrLocalWidthSnapshots("glider", "source_net_8")
  expect(traceLengthMm).toBeCloseTo(34.1787052, 5)
  expect(traceNominalMm).toBe(0)
  await expect(boardSvg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "board",
    scale: 1,
  })
  await expect(traceSvg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "trace",
    scale: 1,
  })
})
