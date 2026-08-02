import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/bugreport79-rk3326-usb/bugreport79-rk3326-usb.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson

test.skip("bugreport79 routes the RK3326 global USB bus", (): void => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
