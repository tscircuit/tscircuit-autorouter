import { expect, test } from "bun:test"
import {
  BrokenTraceSegment,
  brokenTraceSegmentInput,
} from "fixtures/repro/broken-trace-segment/broken-trace-segment.fixture"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("broken trace segment", () => {
  const solver = new BrokenTraceSegment(brokenTraceSegmentInput)

  solver.solve()

  const hdRoutes = solver.highDensityRouteSolver?.routes ?? []
  expect(hdRoutes.length).toBeGreaterThan(0)
  expect(hdRoutes.every((route) => route.regionId)).toBe(true)
  expect(
    solver.highDensityForceImproveSolver
      ?.getOutput()
      .every((route) => route.regionId),
  ).toBe(true)
  expect(
    solver.highDensityRepairSolver
      ?.getOutput()
      .every((route) => route.regionId),
  ).toBe(true)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
