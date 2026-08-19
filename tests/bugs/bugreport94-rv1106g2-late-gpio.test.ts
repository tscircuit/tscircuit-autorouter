import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport94-rv1106g2-late-gpio/bugreport94-rv1106g2-late-gpio.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const rv1106G2LateGpioSrj = srj as SimpleRouteJson

test("bugreport94 reproduces rv1106g2 late gpio iteration exhaustion", () => {
  expect(rv1106G2LateGpioSrj.connections).toHaveLength(4)
  expect(rv1106G2LateGpioSrj.obstacles).toHaveLength(389)
  expect(rv1106G2LateGpioSrj.traces).toHaveLength(205)

  const solver = new AutoroutingPipelineSolver(
    structuredClone(rv1106G2LateGpioSrj),
  )

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
