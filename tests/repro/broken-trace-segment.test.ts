import { expect, test } from "bun:test"
import {
  BrokenTraceSegment,
  brokenTraceSegmentInput,
} from "fixtures/repro/broken-trace-segment/broken-trace-segment.fixture"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("broken trace segment", () => {
  const solver = new BrokenTraceSegment(brokenTraceSegmentInput)

  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
