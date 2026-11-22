import { expect, test } from "bun:test"
import { getDdrLocalWidthSnapshots } from "tests/fixtures/getDdrLocalWidthSnapshots"

test("measures OrangeCrab A11 copper at its requested DDR width", async (): Promise<void> => {
  const { boardSvg, traceSvg, traceLengthMm, traceNominalMm } =
    getDdrLocalWidthSnapshots("orangecrab", "source_net_3")
  expect(traceLengthMm).toBeCloseTo(12.6296092, 5)
  expect(traceNominalMm).toBeCloseTo(6.7053608, 5)
  await expect(boardSvg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "board",
    scale: 1,
  })
  await expect(traceSvg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "trace",
    scale: 1,
  })
})
