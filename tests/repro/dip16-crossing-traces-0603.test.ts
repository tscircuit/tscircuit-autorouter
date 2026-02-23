import { test, expect } from "bun:test"
import reproJson from "./dip16-crossing-traces.json"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AssignableAutoroutingPipeline3 } from "lib/index"

test.skip("dip16 crossing traces 0603", () => {
  const solver = new AssignableAutoroutingPipeline3({
    ...(reproJson as SimpleRouteJson),
    availableJumperTypes: ["0603"],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
