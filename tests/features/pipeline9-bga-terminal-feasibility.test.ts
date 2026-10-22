import { expect, test } from "bun:test"
import { getUnroutableBgaTerminalError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getUnroutableBgaTerminalError"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getTrappedBgaTerminalFixture } from "tests/fixtures/getTrappedBgaTerminalFixture"

test("BGA feasibility rejects only when both trace and via escape are blocked", (): void => {
  const { srj, components } = getTrappedBgaTerminalFixture()
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  expect(getUnroutableBgaTerminalError(srj, components, connMap)).toContain(
    'terminal "center" in BGA "bga"',
  )

  // A small via can fit even though the trace cannot pass the surrounding pads.
  srj.minViaPadDiameter = 0.25
  srj.minViaHoleDiameter = 0.1
  srj.allowViaInPad = true
  expect(getUnroutableBgaTerminalError(srj, components, connMap)).toBeNull()

  // Explicit snake-case dimensions take precedence over the camel-case ones.
  srj.min_via_pad_diameter = 0.45
  srj.min_via_hole_diameter = 0.3
  expect(getUnroutableBgaTerminalError(srj, components, connMap)).not.toBeNull()

  // The via is too big again, but a narrow trace can escape on the pad's layer.
  srj.minTraceWidth = 0.05
  srj.minTraceToPadEdgeClearance = 0.025
  expect(getUnroutableBgaTerminalError(srj, components, connMap)).toBeNull()

  // A clearance exactly at the diagonal opening is not proven impossible.
  srj.minTraceWidth = Math.SQRT2 * (0.4 - 0.208) - 0.05
  expect(getUnroutableBgaTerminalError(srj, components, connMap)).toBeNull()
})
