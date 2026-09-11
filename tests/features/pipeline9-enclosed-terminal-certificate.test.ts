import { expect, test } from "bun:test"
import { getEnclosedTerminalError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getEnclosedTerminalError"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createEnclosedTerminalFixture } from "../fixtures/pipeline9-enclosed-terminal-fixture"

test("four foreign pads certify an enclosed terminal even with diagonal trace escapes considered", (): void => {
  const srj = createEnclosedTerminalFixture()
  // The diagonally adjacent blocker corners are closer than the diameter of
  // the trace clearance envelope, closing the gaps between all four walls.
  const diagonalGap = Math.SQRT2 * (0.4 - 0.208)
  expect(diagonalGap).toBeLessThan(srj.minTraceWidth + 2 * srj.minTraceToPadEdgeClearance!)
  const error = getEnclosedTerminalError(srj, getConnectivityMapFromSimpleRouteJson(srj), 0.45)
  expect(error).toContain("Unroutable terminal center_port")
  expect(error).toContain("every reachable 0.45 mm via overlaps its pad")

  srj.layerCount = 1
  expect(getEnclosedTerminalError(srj, getConnectivityMapFromSimpleRouteJson(srj), 0.45)).toContain("Unroutable terminal center_port")
})
