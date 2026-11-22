import { expect, test } from "bun:test"
import { getDdrLocalWidthSnapshots } from "tests/fixtures/getDdrLocalWidthSnapshots"

test("Glider DDR fits ADDR5 and CKE at full width beside round pads", async (): Promise<void> => {
  const address = getDdrLocalWidthSnapshots("glider", "source_net_10")
  const clockEnable = getDdrLocalWidthSnapshots("glider", "source_net_19_mst1")

  for (const trace of [address, clockEnable]) {
    expect(trace.traceLengthMm).toBeGreaterThan(0)
    expect(trace.traceNominalMm).toBeCloseTo(trace.traceLengthMm, 6)
  }

  await expect(address.traceSvg).toMatchSvgSnapshot(import.meta.path, {
    scale: 1,
  })
})
